/** Live provider-directory lookup used by the generic model settings plugin. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmModelInfo,
  LlmRuntime,
} from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the model route's credential reference from the registered settings. */
function credentialReference(
  settings: SettingsProvider,
  settingsNs: string,
  provider: string | undefined,
): string | undefined {
  const service = settings as unknown as { get(namespace: string): unknown }
  const section = service.get(settingsNs)
  if (!isRecord(section)) return undefined
  const profile = provider !== undefined && isRecord(section['providers'])
    ? section['providers'][provider]
    : section
  if (!isRecord(profile)) return undefined
  const reference = profile['apiKeyEnv']
  return typeof reference === 'string' && reference.length > 0 ? reference : undefined
}

async function storedApiKey(
  settings: SettingsProvider,
  credentials: CredentialProvider,
  settingsNs: string,
  provider: string | undefined,
): Promise<string | undefined> {
  const reference = credentialReference(settings, settingsNs, provider)
  if (reference === undefined) return undefined
  try {
    return (await credentials.resolve(credentialRef(reference)))?.value
  } catch {
    return undefined
  }
}

const MODELS_DEV_URL = 'https://models.dev/api.json'
const MODELS_DEV_TTL_MS = 5 * 60 * 1000
// models.dev rejects non-browser user agents (HTTP 403); keep a browser-like UA.
const MODELS_DEV_HEADERS = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
} as const
let modelsDevCache: { expires: number; data: unknown } | undefined

// Single master table per modelId (upstream + local fallback). Product-owned single source.
const MASTER_CATALOG_URL = 'https://models.dev/api.json'
let masterCatalogCache: Record<string, { contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | null }> | undefined
async function masterCatalog(): Promise<Record<string, { contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | null }>> {
  if (masterCatalogCache !== undefined) return masterCatalogCache
  // Try product/config/model-catalog.json as local fallback (built artifact copies it to plugin assets at build)
  const candidates = [
    // When running from product source checkout
    new URL('../../../product/config/model-catalog.json', import.meta.url),
    // When bundled plugin tries relative to its own location
    new URL('./model-catalog.json', import.meta.url),
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json() as { models?: Record<string, unknown> }
        if (json?.models && typeof json.models === 'object') {
          masterCatalogCache = json.models as Record<string, { contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | null }>
          return masterCatalogCache
        }
      }
    } catch {}
    // Fallback to fs for node host (tests, sync). The self-location candidate
    // resolves from the plugin's own bundle and works regardless of cwd.
    try {
      const { readFileSync } = await import('node:fs')
      const { dirname, resolve } = await import('node:path')
      const { fileURLToPath } = await import('node:url')
      const fsCandidates = [
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../product/config/model-catalog.json'),
        resolve(process.cwd(), 'product/config/model-catalog.json'),
        resolve(new URL('.', import.meta.url).pathname, '../product/config/model-catalog.json'),
      ]
      for (const p of fsCandidates) {
        try {
          const raw = readFileSync(p, 'utf8')
          const json = JSON.parse(raw) as { models?: Record<string, unknown> }
          if (json?.models && typeof json.models === 'object') {
            masterCatalogCache = json.models as Record<string, { contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | null }>
            return masterCatalogCache
          }
        } catch {}
      }
    } catch {}
  }
  masterCatalogCache = {}
  return masterCatalogCache
}

function providerKey(provider: string): string {
  return provider.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function modelInfoToDiscovered(model: LlmModelInfo): LlmDiscoveredModel {
  return { id: model.id, name: model.name }
}

/** Apply the saved model selection to every provider's shared runtime catalog. */
function configuredModels(
  settings: SettingsProvider,
  llm: LlmRuntime,
  provider: string,
  models: readonly LlmModelInfo[],
): LlmModelInfo[] {
  const entry = llm.listConfigurableProviders().find(candidate => candidate.provider === provider)
  if (entry === undefined || entry.settingsNs.length === 0) return [...models]
  const section = settings.get(entry.settingsNs)
  if (!isRecord(section)) return [...models]
  let profile: unknown = section
  for (const segment of entry.settingsPath) {
    if (!isRecord(profile)) return [...models]
    profile = profile[segment]
  }
  if (!isRecord(profile) || !Array.isArray(profile['models'])) return [...models]
  const selected = new Set(profile['models'].flatMap(model => (
    isRecord(model) && typeof model['id'] === 'string' ? [model['id']] : []
  )))
  return models.filter(model => selected.has(model.id))
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

async function modelsDevCatalog(provider: string, signal?: AbortSignal): Promise<readonly LlmDiscoveredModel[]> {
  const now = Date.now()
  if (modelsDevCache !== undefined && modelsDevCache.expires > now) {
    return readModelsDevProvider(modelsDevCache.data, provider)
  }
  const response = await fetch(MODELS_DEV_URL, { signal, headers: MODELS_DEV_HEADERS })
  if (!response.ok) throw new Error(`Models.dev returned HTTP ${response.status}`)
  const data: unknown = await response.json()
  modelsDevCache = { expires: now + MODELS_DEV_TTL_MS, data }
  return readModelsDevProvider(data, provider)
}

function readModelsDevProvider(data: unknown, provider: string): readonly LlmDiscoveredModel[] {
  if (!isRecord(data)) return []
  const wanted = providerKey(provider)
  const aliases = new Set([wanted, wanted.replace(/-relay$|-(tokens|gateway|api)$/g, '')])
  const raw = Object.entries(data).find(([key]) => aliases.has(providerKey(key)))?.[1]
  if (!isRecord(raw)) return []
  const models = raw['models']
  if (!isRecord(models)) return []
  const result: LlmDiscoveredModel[] = []
  for (const [id, value] of Object.entries(models)) {
    if (isRecord(value)) {
      // Models.dev calls the human-facing model alias `name`; a few mirrors
      // expose `alias`, so prefer it without losing the canonical id.
      const name = typeof value['alias'] === 'string'
        ? value['alias']
        : typeof value['display_name'] === 'string'
          ? value['display_name']
          : typeof value['name'] === 'string' ? value['name'] : undefined
      const limit = isRecord(value['limit']) ? value['limit'] : undefined
      const contextWindow = limit === undefined ? undefined : positiveInteger(limit['context'])
      const maxTokens = limit === undefined ? undefined : positiveInteger(limit['output'])
      result.push({
        id,
        ...name === undefined ? {} : { name },
        ...contextWindow === undefined ? {} : { contextWindow },
        ...maxTokens === undefined ? {} : { maxTokens },
      })
    } else result.push({ id })
  }
  return result
}

/** Merge public metadata into a supplier directory without replacing supplier ids or labels. */
async function enrichMissingMetadata(
  provider: string,
  models: readonly LlmDiscoveredModel[],
  signal?: AbortSignal,
): Promise<readonly LlmDiscoveredModel[]> {
  if (provider.length === 0 || models.length === 0 || models.every(model => (
    model.name !== undefined && model.contextWindow !== undefined && model.maxTokens !== undefined
  ))) return models
  let fallback: readonly LlmDiscoveredModel[] | undefined
  try {
    fallback = await modelsDevCatalog(provider, signal)
  } catch {
    fallback = undefined
  }
  // Master catalog is the single per-modelId source (upstream models.dev + local product/config/model-catalog.json)
  let master: Record<string, { contextWindow?: number; maxTokens?: number }> | undefined
  try {
    master = await masterCatalog()
  } catch {
    master = undefined
  }
  const byId = fallback ? new Map(fallback.map(model => [model.id, model])) : new Map<string, LlmDiscoveredModel>()
  return models.map(model => {
    const supplement = byId.get(model.id)
    const masterEntry = master?.[model.id]
    const name = supplement?.name ?? (masterEntry !== undefined ? (masterEntry as { name?: string }).name : undefined)
    const contextWindow = supplement?.contextWindow ?? masterEntry?.contextWindow
    const maxTokens = supplement?.maxTokens ?? masterEntry?.maxTokens
    if (supplement === undefined && masterEntry === undefined) return model
    return {
      ...model,
      ...model.name === undefined && name !== undefined ? { name } : {},
      ...model.contextWindow === undefined && contextWindow !== undefined
        ? { contextWindow }
        : {},
      ...model.maxTokens === undefined && maxTokens !== undefined
        ? { maxTokens }
        : {},
    }
  })
}

/**
 * Ask one draft route for its current provider directory. `undefined` means
 * the live source was unavailable, so the caller may use the official static
 * catalog as a fallback.
 */
export async function discoverLiveModels(
  discover: (
    settingsNs: string,
    request: LlmModelDiscoveryRequest,
  ) => Promise<readonly LlmDiscoveredModel[]>,
  settings: SettingsProvider,
  credentials: CredentialProvider,
  settingsNs: string,
  request: LlmModelDiscoveryRequest,
): Promise<readonly LlmDiscoveredModel[] | undefined> {
  if (request.baseURL === undefined || request.baseURL.length === 0) return undefined
  const apiKey = request.provider === undefined
    ? request.apiKey
    : request.apiKey ?? await storedApiKey(settings, credentials, settingsNs, request.provider)
  const { provider: _provider, ...endpointRequest } = request
  try {
    // Omitting provider bypasses an adapter's static-catalog short circuit and
    // interrogates the endpoint currently shown by the editor.
    return await discover(settingsNs, apiKey === undefined
      ? endpointRequest
      : { ...endpointRequest, apiKey })
  } catch (error: unknown) {
    if (request.signal?.aborted) throw error
  }
  return undefined
}

/** Install the live-first behavior without changing the official LLM runtime. */
export function installLiveModelDiscovery(ctx: Context): void {
  ctx.inject(['llm', 'settings', 'credentials'], (services) => {
    const llm = services.llm as LlmRuntime
    const original = llm.discoverModels
    const originalListModels = llm.listModels.bind(llm)
    const originalResolveModelInfo = llm.resolveModelInfo.bind(llm)
    const filteredListModels: typeof llm.listModels = async (provider) => (
      configuredModels(services.settings, llm, provider, await originalListModels(provider))
    )
    const enrichedResolveModelInfo: typeof llm.resolveModelInfo = async (provider, model, signal) => {
      const resolved = await originalResolveModelInfo(provider, model, signal)
      if (resolved.inputModalities !== undefined) return resolved
      const listed = await originalListModels(provider)
      const entry = listed.find(candidate => candidate.id === model)
      return entry?.inputModalities === undefined
        ? resolved
        : { ...resolved, inputModalities: [...entry.inputModalities] }
    }
    const richListModels = async (provider: string): Promise<LlmDiscoveredModel[]> => {
      const listed = await originalListModels(provider)
      const enriched: LlmDiscoveredModel[] = []
      for (const model of listed) {
        try {
          const info = await llm.resolveModelInfo(provider, model.id)
          enriched.push({
            id: model.id,
            name: model.name,
            ...info.context?.contextWindow === undefined ? {} : { contextWindow: info.context.contextWindow },
            ...info.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens },
          })
        } catch {
          enriched.push(modelInfoToDiscovered(model))
        }
      }
      return enriched
    }
    const wrapped: typeof original = async function (settingsNs, request) {
      const live = await discoverLiveModels(
        (namespace, liveRequest) => original.call(llm, namespace, liveRequest),
        services.settings,
        services.credentials,
        settingsNs,
        request,
      )
      if (live !== undefined) {
        return [...await enrichMissingMetadata(request.provider ?? '', live, request.signal)]
      }
      try {
        const originalModels = await original.call(llm, settingsNs, request)
        return [...await enrichMissingMetadata(request.provider ?? '', originalModels, request.signal)]
      } catch (error: unknown) {
        if (request.signal?.aborted) throw error
      }
      if (request.provider !== undefined) {
        try {
          const listed = await richListModels(request.provider)
          if (listed.length > 0) return listed
        } catch (error: unknown) {
          if (request.signal?.aborted) throw error
        }
        try {
          const fallback = await modelsDevCatalog(request.provider, request.signal)
          if (fallback.length > 0) return [...fallback]
        } catch (error: unknown) {
          if (request.signal?.aborted) throw error
        }
      }
      throw new Error(`no model directory is available for provider "${request.provider ?? ''}"`)
    }
    llm.discoverModels = wrapped
    llm.listModels = filteredListModels
    llm.resolveModelInfo = enrichedResolveModelInfo
    services.effect(() => () => {
      if (llm.discoverModels === wrapped) llm.discoverModels = original
      if (llm.listModels === filteredListModels) llm.listModels = originalListModels
      if (llm.resolveModelInfo === enrichedResolveModelInfo) llm.resolveModelInfo = originalResolveModelInfo
    }, 'dsh-model-settings: live model discovery')
  })
}
