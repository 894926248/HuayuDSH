// ocgo-tab-ring — Host half
// 读取 OpenCodeGo 和 Command Code 的 API Key-backed usage 数据，
// 并通过同源 /ocgo-tab-ring/api 返回给 Client。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'ocgo-tab-ring'
export const inject = ['webServer', 'credentials', 'settings']

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const FETCH_TIMEOUT_MS = 15000
const COMMAND_CODE_API_BASE = 'https://api.commandcode.ai'
const COMMAND_CODE_API_KEY_REF = 'COMMANDCODE_API_KEY'
const COMMAND_CODE_CLI_VERSION = '1.31.0'
const GO_MODEL_PREFIX = 'opencode-go/'
const TOKEN_KEYS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']
const GO_PRICE_PER_MILLION = Object.freeze({
  input: 0.44,
  output: 1.32,
  reasoning: 1.32,
  cacheRead: 0.014,
  cacheWrite: 0,
})

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || ''
}

function dshHome() {
  return process.env.DSH_HOME || join(homeDir(), '.dsh')
}

function findDataDir() {
  const home = homeDir()
  if (!home) return null
  if (process.env.OPENCODE_DATA_DIR && existsSync(process.env.OPENCODE_DATA_DIR)) {
    return process.env.OPENCODE_DATA_DIR
  }
  const d = join(home, '.local', 'share', 'opencode')
  return existsSync(d) ? d : null
}

function readApiKey(dataDir) {
  try {
    const p = join(dataDir, 'auth.json')
    if (!existsSync(p)) return null
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return j['opencode-go']?.key || j['opencode']?.key || j.key || null
  } catch {
    return null
  }
}

function emptyTokens() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function tokensFromUsage(value) {
  if (!value || typeof value !== 'object') return emptyTokens()
  return {
    input: finiteNumber(value.inputTokens ?? value.input),
    output: finiteNumber(value.outputTokens ?? value.output),
    reasoning: finiteNumber(value.reasoningTokens ?? value.reasoning),
    cacheRead: finiteNumber(value.cacheReadTokens ?? value.cacheRead),
    cacheWrite: finiteNumber(value.cacheWriteTokens ?? value.cacheWrite),
  }
}

function addTokens(target, source) {
  for (const key of TOKEN_KEYS) target[key] += finiteNumber(source[key])
}

function subtractTokens(left, right) {
  const result = emptyTokens()
  for (const key of TOKEN_KEYS) result[key] = Math.max(0, finiteNumber(left[key]) - finiteNumber(right[key]))
  return result
}

function hasTokens(tokens) {
  return TOKEN_KEYS.some((key) => tokens[key] > 0)
}

function modelIsGo(model) {
  return typeof model === 'string' && model.startsWith(GO_MODEL_PREFIX)
}

function costFrom(value) {
  if (!value || typeof value !== 'object') return null
  for (const key of ['cost', 'totalCost', 'spend']) {
    const amount = value[key]
    if (typeof amount === 'number' && Number.isFinite(amount)) return amount
  }
  return null
}

function estimateCost(tokens) {
  return TOKEN_KEYS.reduce((total, key) => total + finiteNumber(tokens[key]) * GO_PRICE_PER_MILLION[key], 0) / 1e6
}

function costFor(value, tokens) {
  return costFrom(value) ?? estimateCost(tokens)
}

function createBucket(sessionId) {
  return {
    ...(sessionId ? { sessionId } : {}),
    tokens: emptyTokens(),
    allTokens: emptyTokens(),
    cost: null,
    requests: 0,
    models: new Map(),
    mtime: 0,
  }
}

function addCost(bucket, amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return
  bucket.cost = (bucket.cost ?? 0) + amount
}

function addModel(bucket, model, tokens, cost, requests) {
  addTokens(bucket.tokens, tokens)
  addCost(bucket, cost)
  bucket.requests += finiteNumber(requests)
  const modelBucket = bucket.models.get(model) || createBucket()
  addTokens(modelBucket.tokens, tokens)
  addCost(modelBucket, cost)
  modelBucket.requests += finiteNumber(requests)
  bucket.models.set(model, modelBucket)
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function periodEndValue(value) {
  const number = numberValue(value)
  if (number !== null) return number
  const string = stringValue(value)
  if (!string) return 0
  const parsed = Date.parse(string)
  return Number.isFinite(parsed) ? parsed : 0
}

function commandCodePlanInfo(planId) {
  if (!planId) return null
  const normalized = planId.toLowerCase().replaceAll('_', '-')
  const plans = [
    ['individual-pro-v1', 'Pro', 80],
    ['individual-ultra', 'Ultra', 300],
    ['individual-provider', 'Provider', 15],
    ['individual-pro', 'Pro', 30],
    ['individual-max', 'Max', 150],
    ['individual-goat', 'GOAT', 70],
    ['individual-go', 'Go', 10],
    ['teams-pro', 'Teams Pro', 40],
  ]
  const match = plans.find(([prefix]) => normalized.startsWith(prefix))
  return match ? { name: match[1], monthlyCredits: match[2] } : { name: planId, monthlyCredits: null }
}

function commandCodeConfig(ctx) {
  try {
    const settings = ctx.get('settings')
    const value = settings && typeof settings.get === 'function'
      ? settings.get('llm-commandcode')
      : null
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function commandCodeAuthFileKey() {
  const parsed = readJson(join(homeDir(), '.commandcode', 'auth.json'))
  if (!isRecord(parsed)) return null
  const direct = stringValue(parsed.apiKey) || stringValue(parsed.commandcode)
  if (direct) return direct
  for (const key of ['commandcode', 'command-code']) {
    const record = parsed[key]
    if (!isRecord(record)) continue
    const value = stringValue(record.key) || stringValue(record.access)
    if (value) return value
  }
  return null
}

async function resolveCommandCodeConnection(ctx) {
  const config = commandCodeConfig(ctx)
  const literal = stringValue(config.apiKey)
  const apiBase = stringValue(config.apiBase) || COMMAND_CODE_API_BASE
  if (literal) return { key: literal, apiBase }

  const ref = stringValue(config.apiKeyEnv) || COMMAND_CODE_API_KEY_REF
  const credentials = ctx.get('credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    const resolved = await credentials.resolve(ref)
    const value = resolved && stringValue(resolved.value)
    if (value) return { key: value, apiBase }
  }

  const fileKey = commandCodeAuthFileKey()
  return fileKey ? { key: fileKey, apiBase } : null
}

function commandCodeModelGroups(value) {
  if (!isRecord(value)) return null
  for (const key of ['byModel', 'models', 'modelUsage']) {
    const candidate = value[key]
    if (Array.isArray(candidate) || isRecord(candidate)) return candidate
  }
  return null
}

async function fetchCommandCodeReport(ctx) {
  const connection = await resolveCommandCodeConnection(ctx)
  if (!connection) return { ok: false, error: 'COMMANDCODE_NO_KEY', source: 'api-key' }

  const headers = {
    Authorization: 'Bearer ' + connection.key,
    Accept: 'application/json',
    'x-command-code-version': COMMAND_CODE_CLI_VERSION,
    'x-cli-environment': 'production',
  }
  const failures = []
  const getJson = async (path) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(connection.apiBase + path, { headers, signal: controller.signal })
      if (!response.ok) {
        failures.push(path + ': HTTP_' + response.status)
        return null
      }
      const body = await response.json()
      if (!isRecord(body)) {
        failures.push(path + ': INVALID_JSON')
        return null
      }
      return body
    } catch (error) {
      const message = error && typeof error.message === 'string' ? error.message : String(error)
      failures.push(path + ': ' + message)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const whoami = await getJson('/alpha/whoami')
  const user = isRecord(whoami?.user) ? whoami.user : null
  const org = isRecord(whoami?.org) ? whoami.org : null
  const orgId = stringValue(org?.id)
  const [summary, credits, subscription] = await Promise.all([
    getJson('/alpha/usage/summary'),
    getJson('/alpha/billing/credits'),
    getJson(orgId
      ? '/alpha/billing/subscriptions?orgId=' + encodeURIComponent(orgId)
      : '/alpha/billing/subscriptions'),
  ])
  const creditValues = isRecord(credits?.credits) ? credits.credits : null
  const limits = isRecord(credits?.windowLimits) ? credits.windowLimits : null
  const fiveHour = isRecord(limits?.fiveHour) ? limits.fiveHour : null
  const weekly = isRecord(limits?.weekly) ? limits.weekly : null
  const subscriptionData = isRecord(subscription?.data) ? subscription.data : null
  const planId = stringValue(subscriptionData?.planId)
  const planInfo = commandCodePlanInfo(planId)
  const monthlyRemaining = numberValue(creditValues?.monthlyCredits)
  const monthlyUsed = numberValue(summary?.totalMonthlyCredits) ?? numberValue(summary?.totalCredits)
  const derivedMonthlyCredits = monthlyRemaining !== null && monthlyUsed !== null
    ? monthlyRemaining + Math.max(0, monthlyUsed)
    : null
  const report = {
    source: 'api-key',
    failures,
  }
  if (user) {
    report.account = {
      id: stringValue(user.id) || '',
      name: stringValue(user.name) || '',
      userName: stringValue(user.userName) || '',
    }
  }
  if (summary) {
    report.usage = {
      totalCount: numberValue(summary.totalCount) ?? 0,
      totalCost: numberValue(summary.totalCost) ?? 0,
      successRate: numberValue(summary.successRate) ?? 0,
      completedCount: numberValue(summary.completedCount) ?? 0,
      failedCount: numberValue(summary.failedCount) ?? 0,
      totalTokensIn: numberValue(summary.totalTokensIn) ?? 0,
      totalTokensOut: numberValue(summary.totalTokensOut) ?? 0,
      totalTokens: numberValue(summary.totalTokens) ?? 0,
      totalCredits: numberValue(summary.totalCredits) ?? 0,
      totalFreeCredits: numberValue(summary.totalFreeCredits) ?? 0,
      totalMonthlyCredits: numberValue(summary.totalMonthlyCredits) ?? 0,
      totalPurchasedCredits: numberValue(summary.totalPurchasedCredits) ?? 0,
      periodBasis: stringValue(summary.periodBasis) || 'billing-period',
    }
    const modelGroups = commandCodeModelGroups(summary)
    if (modelGroups) report.byModel = modelGroups
  }
  if (creditValues || fiveHour || weekly) {
    report.credits = {
      monthlyCredits: monthlyRemaining ?? 0,
      purchasedCredits: numberValue(creditValues?.purchasedCredits) ?? 0,
      freeCredits: numberValue(creditValues?.freeCredits) ?? 0,
      fiveHour: {
        used: numberValue(fiveHour?.used) ?? 0,
        cap: numberValue(fiveHour?.cap) ?? 0,
        exceeded: fiveHour?.exceeded === true,
        resetAt: numberValue(fiveHour?.resetAt) ?? 0,
      },
      weekly: {
        used: numberValue(weekly?.used) ?? 0,
        cap: numberValue(weekly?.cap) ?? 0,
        exceeded: weekly?.exceeded === true,
        resetAt: numberValue(weekly?.resetAt) ?? 0,
      },
    }
  }
  if (subscriptionData || planId) {
    report.plan = {
      planId: planId || '',
      name: planInfo?.name || planId || '',
      status: stringValue(subscriptionData?.status) || '',
      monthlyCredits: planInfo?.monthlyCredits ?? derivedMonthlyCredits,
      currentPeriodEnd: periodEndValue(subscriptionData?.currentPeriodEnd),
    }
  }
  if (!report.account && !report.usage && !report.credits && !report.plan) {
    const failure = failures.find((value) => value.includes('HTTP_')) || ''
    const error = failure.includes('HTTP_401')
      ? 'COMMANDCODE_HTTP_401'
      : failure.includes('HTTP_403')
        ? 'COMMANDCODE_HTTP_403'
        : failure.includes('HTTP_429')
          ? 'COMMANDCODE_HTTP_429'
          : 'COMMANDCODE_QUERY_FAILED'
    return { ok: false, error, source: 'api-key' }
  }
  return { ok: true, source: 'api-key', report }
}

function readHarnessStats() {
  const root = join(dshHome(), 'storages')
  const usage = readJson(join(root, 'usage-stats-cache.json'))
  const projections = readJson(join(root, 'session_projcache.json'))
  const global = createBucket()
  const sessions = new Map()

  for (const [sessionId, record] of Object.entries(usage?.sessions || {})) {
    const session = sessions.get(sessionId) || createBucket(sessionId)
    for (const [day, dayRecord] of Object.entries(record?.days || {})) {
      const dayTime = Date.parse(day + 'T00:00:00Z')
      if (Number.isFinite(dayTime)) session.mtime = Math.max(session.mtime, dayTime)
      for (const [model, modelUsage] of Object.entries(dayRecord?.models || {})) {
        const tokens = tokensFromUsage(modelUsage)
        addTokens(session.allTokens, tokens)
        if (!modelIsGo(model)) continue
        const cost = costFor(modelUsage, tokens)
        addModel(global, model, tokens, cost, modelUsage?.requests)
        addModel(session, model, tokens, cost, modelUsage?.requests)
      }
    }
    if (modelIsGo(record?.currentModel)) session.currentModel = record.currentModel
    sessions.set(sessionId, session)
  }

  for (const [sessionId, record] of Object.entries(projections?.tables?.sessions || {})) {
    const session = sessions.get(sessionId) || createBucket(sessionId)
    const projected = tokensFromUsage(record?.rows?.tokenUsage?.val?.totals)
    const delta = subtractTokens(projected, session.allTokens)
    const model = session.currentModel
    if (modelIsGo(model) && hasTokens(delta)) {
      const cost = estimateCost(delta)
      addModel(global, model, delta, cost, 0)
      addModel(session, model, delta, cost, 0)
    }
    const createdAt = finiteNumber(record?.identity?.createdAt)
    session.mtime = Math.max(session.mtime, createdAt)
    sessions.set(sessionId, session)
  }

  const serializeBucket = (bucket) => ({
    tokens: bucket.tokens,
    cost: bucket.cost,
    requests: bucket.requests,
    byModel: [...bucket.models.entries()]
      .filter(([, value]) => hasTokens(value.tokens))
      .map(([model, value]) => ({ model, tokens: value.tokens, cost: value.cost, requests: value.requests }))
      .sort((a, b) => tokenTotal(b.tokens) - tokenTotal(a.tokens)),
  })

  return {
    tokens: global.tokens,
    cost: global.cost,
    byModel: serializeBucket(global).byModel,
    bySession: [...sessions.values()]
      .filter((value) => hasTokens(value.tokens))
      .map((value) => ({
        sessionId: value.sessionId,
        mtime: value.mtime,
        ...serializeBucket(value),
      }))
      .sort((a, b) => b.mtime - a.mtime),
  }
}

function tokenTotal(tokens) {
  return TOKEN_KEYS.reduce((total, key) => total + finiteNumber(tokens[key]), 0)
}

async function fetchQuota(key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) return { error: 'HTTP_' + res.status }
    const body = await res.json()
    const u = (body && body.usage) || body || {}
    const pick = (w) => (w && typeof w === 'object'
      ? {
          percent: typeof w.percent === 'number' ? w.percent : null,
          resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : null,
          status: typeof w.status === 'string' ? w.status : null,
        }
      : null)
    return {
      rolling: pick(u.rolling),
      weekly: pick(u.weekly),
      monthly: pick(u.monthly),
      error: null,
    }
  } catch (e) {
    return { error: 'NETWORK:' + String((e && e.message) || e) }
  } finally {
    clearTimeout(timer)
  }
}

async function collect(ctx) {
  const dataDir = findDataDir()
  const key = dataDir ? readApiKey(dataDir) : null
  const out = { ok: false, keyConfigured: !!key, stats: readHarnessStats() }
  const [quota, commandCode] = await Promise.all([
    key ? fetchQuota(key) : Promise.resolve({ error: 'NO_KEY' }),
    fetchCommandCodeReport(ctx),
  ])
  out.commandCode = commandCode
  if (quota.error) out.error = quota.error
  else {
    out.quota = quota
    out.ok = true
  }
  return out
}

export function apply(ctx) {
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/ocgo-tab-ring/api',
      handler: async (_req, res) => {
        try {
          const data = await collect(ctx)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(data))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      },
    }), 'ocgo-tab-ring: route')
  }

  ctx.logger?.info?.('[' + name + '] started (/ocgo-tab-ring/api)')
}
