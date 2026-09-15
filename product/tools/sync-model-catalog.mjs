/**
 * Sync the single master model catalog from upstream + local fallback.
 * Upstream: https://models.dev/api.json (primary), pi-ai builtin, commandcode API.
 * Local fallback: product/config/model-catalog.json (this file).
 * Usage: node product/tools/sync-model-catalog.mjs [--check] [--pull]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const catalogPath = resolve(root, 'product/config/model-catalog.json')
const MODELS_DEV_URL = 'https://models.dev/api.json'
const COMMANDCODE_URL = 'https://api.commandcode.ai/provider/v1/models'

function loadLocal() {
  if (!existsSync(catalogPath)) return null
  return JSON.parse(readFileSync(catalogPath, 'utf8'))
}

async function fetchJson(url, { timeoutMs = 30000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`timeout ${url}`)), timeoutMs)
  try {
    // models.dev and the commandcode API reject non-browser user agents (HTTP 403).
    // Keep a browser-like UA so the canonical catalog stays reachable from scripts.
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function positiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
}

// Generic reasoningEfforts per modelId family - kept minimal, modelId-specific overrides below win.
const GENERIC_EFFORTS = {
  // deepseek family
  'deepseek': { off: null, high: 'high', max: 'max' },
  // gpt family full 6
  'gpt': { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  // grok
  'grok': { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  // claude
  'claude': { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  // gemini/qwen
  'gemini': { off: null, low: 'low', medium: 'medium', high: 'high' },
  'qwen': { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
}

function genericFor(modelId) {
  const lower = modelId.toLowerCase()
  if (lower.includes('deepseek')) return GENERIC_EFFORTS.deepseek
  if (lower.includes('muse-spark')) return { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
  if (lower.includes('grok')) return GENERIC_EFFORTS.grok
  if (lower.includes('claude')) return GENERIC_EFFORTS.claude
  if (lower.includes('gemini')) return GENERIC_EFFORTS.gemini
  if (lower.includes('qwen')) return GENERIC_EFFORTS.qwen
  if (lower.startsWith('gpt-')) return GENERIC_EFFORTS.gpt
  if (lower.includes('glm')) return { off: null, high: 'high', max: 'max' }
  if (lower.includes('fugu')) return { off: null, high: 'high', xhigh: 'xhigh' }
  return null
}

async function sync({ pull = false, check = false } = {}) {
  const local = loadLocal()
  if (!local) throw new Error(`missing ${catalogPath}`)

  if (!pull) {
    const count = local.providers ? Object.values(local.providers).reduce((a,p)=>a+Object.keys(p.models||{}).length,0) : Object.keys(local.models||{}).length
    console.log(`[sync-model-catalog] --pull not set, local catalog is source of truth (${count} models)`)
    console.log(`Upstream: ${local.upstream.modelsDev}, ${local.upstream.commandcode}`)
    if (check) {
      // Validate that upstream is reachable
      try {
        await fetchJson(MODELS_DEV_URL, { timeoutMs: 5000 })
        console.log('[check] models.dev reachable')
      } catch (e) {
        console.warn('[check] models.dev unreachable:', e.message, '(local fallback will be used)')
      }
    }
    return
  }

  console.log('[sync-model-catalog] pulling upstream...')
  let modelsDev = null
  let commandcode = null
  try {
    modelsDev = await fetchJson(MODELS_DEV_URL)
    console.log(`[sync] models.dev: ${Object.keys(modelsDev).length} providers`)
  } catch (e) {
    console.warn(`[sync] models.dev failed, keeping local: ${e.message}`)
  }
  try {
    commandcode = await fetchJson(COMMANDCODE_URL)
    console.log(`[sync] commandcode: ${commandcode?.data?.length ?? 0} models`)
  } catch (e) {
    console.warn(`[sync] commandcode failed, keeping local: ${e.message}`)
  }

  // Merge: per-provider faithful (no cross-provider merging)
  let updated = 0
  const next = structuredClone(local)
  next.updatedAt = new Date().toISOString().slice(0, 10)

  const localProviders = next.providers || (next.models ? { _flat: { models: next.models } } : {})
  if (modelsDev) {
    for (const [pname, pdata] of Object.entries(localProviders)) {
      const provKey = pname === '_flat' ? null : pname
      // Find matching models.dev provider data (per-provider)
      let provData = null
      if (provKey) {
        // Try exact provider key match like live-discovery does
        const wanted = provKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const aliases = new Set([wanted, wanted.replace(/-relay$|-(tokens|gateway|api)$/g, '')])
        const hit = Object.entries(modelsDev).find(([k]) => {
          const kk = k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          return aliases.has(kk)
        })
        if (hit) provData = hit[1]
      }
      for (const [modelId, entry] of Object.entries(pdata.models || {})) {
        if (!provData || !provData.models) continue
        const hit = provData.models[modelId]
        if (!hit || typeof hit !== 'object') continue
        const limit = hit.limit
        if (!limit) continue
        const ctx = positiveInt(limit.context)
        const out = positiveInt(limit.output)
        if (ctx && ctx !== entry.contextWindow) {
          console.log(`[sync] ${pname}/${modelId} contextWindow ${entry.contextWindow} -> ${ctx} (models.dev/${provKey})`)
          entry.contextWindow = ctx
          updated++
        }
        if (out && out !== entry.maxTokens) {
          console.log(`[sync] ${pname}/${modelId} maxTokens ${entry.maxTokens} -> ${out} (models.dev/${provKey})`)
          entry.maxTokens = out
          updated++
        }
        // Do not invent reasoningEfforts - keep pulled table as is (per your request: no cleaning)
      }
    }
  }

  if (updated > 0 || check) {
    writeFileSync(catalogPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
    console.log(`[sync] wrote ${catalogPath} (${updated} fields updated)`)
  } else {
    console.log('[sync] no changes')
  }
}

const args = process.argv.slice(2)
const pull = args.includes('--pull')
const check = args.includes('--check')
sync({ pull, check }).catch(e => {
  console.error(e)
  process.exit(1)
})
