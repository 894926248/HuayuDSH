// dsh-opencodego-usage card adapted for ocgo-tab-ring.
// The liquid-glass card is retained; the mount point, quota progress, and
// compact aggregate token summary are owned here.
window.__ModuleLoader__.load({
  id: 'ocgo-tab-ring',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports
    const inject = ['slots']

    const CSS = `
      @keyframes ocgr-enter {
        from { opacity: 0; transform:translateY(-4px) scale(.98); }
        to   { opacity: 1; transform:translateY(0) scale(1); }
      }
      .ocgr-root { display:inline-flex; position:relative; }
      .ocgr-trigger { width:28px; height:28px; cursor:pointer; background:none; border:none; border-radius:999px; flex:none; place-items:center; display:grid; }
      .ocgr-trigger:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15)); }
      [data-slot="sidebar"] > * { position:relative; }
      .ocgr-sidebar-host {
        /* Keep a layout-only fallback until the mounted settings trigger is
           measurable; the client effect then replaces bottom with a top
           offset centered on that trigger. */
        position:absolute; right:4px; bottom:7px; z-index:40;
        width:36px; height:36px; display:inline-flex;
        align-items:center; justify-content:center;
      }
      .ocgr-ring,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot {
        display:block; flex:none; width:14px; min-width:14px; height:14px;
      }
      .ocgr-ring-track {
        fill:none;
        stroke:var(--dsw-alias-border-l3, rgba(128,128,128,.35));
        stroke-width:2;
      }
      .ocgr-ring-fill {
        fill:none;
        stroke:var(--ocgr-ring-color, var(--dsw-alias-label-tertiary, #777));
        stroke-width:2;
        stroke-linecap:round;
      }
      .ocgr-ring-idle,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot.ocgr-idle {
        --ocgr-ring-color:var(--dsw-alias-label-tertiary, #777);
      }
      .ocgr-ring-ok,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot.ocgr-ok {
        --ocgr-ring-color:var(--dsw-alias-state-success-primary, #3fb950);
      }
      .ocgr-ring-warn,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot.ocgr-warn {
        --ocgr-ring-color:var(--dsw-alias-state-warn-primary, #d29922);
      }
      .ocgr-ring-low,
      .ocgr-ring-err,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot.ocgr-low,
      [data-slot="conversation.input.right"] .ocgr-root .ocgr-dot.ocgr-err {
        --ocgr-ring-color:var(--dsw-alias-state-error-primary, #f66);
      }
      .ocgr-panel {
        z-index:100000; box-sizing:border-box; width:min(300px, calc(100vw - 16px)); max-width:calc(100vw - 16px); max-height:min(560px, calc(100vh - 24px));
        border-radius:12px; padding:12px 14px; overflow-x:hidden; overflow-y:auto;
        font-size:11px; line-height:18px; position:fixed;
        bottom:auto; right:auto;
        display:flex; flex-direction:column; gap:6px;
        color:var(--dsw-alias-label-secondary, #bbb);
        --gx:20%; --gy:0%;
        transform-origin:top center;
        animation:ocgr-enter .2s ease-out;
        background:
          radial-gradient(560px circle at var(--gx) var(--gy), rgba(255,255,255,.16), transparent 45%),
          radial-gradient(120% 90% at 18% 0%, rgba(255,255,255,.10), transparent 50%),
          linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.02)),
          rgba(20,22,30,.16);
        border:1px solid rgba(255,255,255,.16);
        backdrop-filter: blur(26px) saturate(170%) brightness(1.08);
        -webkit-backdrop-filter: blur(26px) saturate(170%) brightness(1.08);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.18),
          inset 0 -1px 0 rgba(255,255,255,.05),
          0 10px 36px rgba(0,0,0,.45);
      }
      .ocgr-panel::-webkit-scrollbar { width:5px; }
      .ocgr-panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,.22); border-radius:999px; }
      @media (prefers-reduced-motion: reduce) {
        .ocgr-panel { animation:none; }
      }
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        .ocgr-panel { background:rgba(28,30,40,.78); }
      }
      .ocgr-header {
        display:grid; grid-template-columns:28px minmax(0, 1fr) 28px auto;
        align-items:center; gap:4px; padding-bottom:2px; min-width:0;
      }
      .ocgr-switch {
        width:28px; height:28px; padding:0; border:0; border-radius:7px;
        display:grid; place-items:center; flex:none; cursor:pointer;
        color:var(--dsw-alias-label-secondary, #bbb);
        background:transparent; font:inherit; font-size:18px; line-height:1;
        touch-action:manipulation;
      }
      .ocgr-switch:hover:not(:disabled) { color:var(--dsw-alias-label-primary, #eee); background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15)); }
      .ocgr-switch:focus-visible { outline:2px solid var(--dsw-alias-state-focus-primary, #7aa2f7); outline-offset:1px; }
      .ocgr-switch:disabled { opacity:.28; cursor:default; }
      .ocgr-headline { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-tertiary, #999); }
      .ocgr-percent { color:var(--dsw-alias-label-primary, #eee); font-weight:600; white-space:nowrap; }
      .ocgr-rows { display:flex; flex-direction:column; gap:4px; }
      .ocgr-win { display:flex; flex-direction:column; gap:2px; }
      .ocgr-winTop { display:grid; grid-template-columns:minmax(58px, auto) minmax(0, 1fr) auto; align-items:baseline; gap:6px; min-width:0; }
      .ocgr-winLabel { color:var(--dsw-alias-label-primary, #eee); font-weight:600; min-width:0; white-space:nowrap; }
      .ocgr-winMeta { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-secondary, #bbb); }
      .ocgr-winReset { color:var(--dsw-alias-label-tertiary, #999); font-size:10px; white-space:nowrap; }
      .ocgr-bar { background:rgba(255,255,255,.12); border-radius:999px; height:5px; overflow:hidden; margin-top:2px; }
      .ocgr-segment { border-radius:1px; height:100%; }
      .ocgr-tokenSection { border-top:1px solid rgba(255,255,255,.12); padding-top:7px; display:flex; flex-direction:column; gap:4px; }
      .ocgr-tokenTitle { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
      .ocgr-tokenTitle { color:var(--dsw-alias-label-primary, #eee); font-weight:600; }
      .ocgr-tokenTotal,
      .ocgr-tokenValue { color:var(--dsw-alias-label-primary, #eee); font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; }
      .ocgr-tokenRows { display:flex; flex-direction:column; gap:1px; }
      .ocgr-tokenRow { display:grid; grid-template-columns:minmax(0, 1fr) auto; column-gap:12px; }
      .ocgr-tokenLabel { color:var(--dsw-alias-label-tertiary, #999); }
      .ocgr-models { border-top:1px solid rgba(255,255,255,.12); padding-top:7px; display:flex; flex-direction:column; gap:3px; }
      .ocgr-modelTitle { color:var(--dsw-alias-label-tertiary, #999); font-size:10px; font-weight:600; }
      .ocgr-modelRow { display:flex; flex-direction:column; gap:1px; min-width:0; }
      .ocgr-modelTop { display:flex; align-items:baseline; justify-content:space-between; gap:10px; min-width:0; }
      .ocgr-modelName { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-primary, #eee); }
      .ocgr-modelMeta { flex:none; color:var(--dsw-alias-label-primary, #eee); font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; }
      .ocgr-modelDetail { color:var(--dsw-alias-label-tertiary, #999); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ocgr-commandMeta { border-top:1px solid rgba(255,255,255,.12); padding-top:7px; }
      .ocgr-commandMeta { display:flex; align-items:baseline; justify-content:space-between; gap:8px; color:var(--dsw-alias-label-tertiary, #999); font-size:10px; min-width:0; }
      .ocgr-commandMetaMain { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ocgr-commandMetaEnd { flex:none; white-space:nowrap; }
      .ocgr-loading { color:var(--dsw-alias-label-tertiary, #999); }
      .ocgr-error {
        color:var(--dsw-alias-state-error-primary, #f66);
        background:rgba(242,90,90,.12);
        border:1px solid rgba(242,90,90,.35);
        border-radius:7px; padding:4px 8px; overflow-wrap:anywhere;
      }
    `

    const USAGE_API = '/ocgo-tab-ring/api'
    const STATS_API = '/ocgo-lite/api'
    const PROVIDER_STORAGE_KEY = 'ocgo-tab-ring.provider'
    const GO_PRICE_PER_MILLION = Object.freeze({
      input: 0.44,
      output: 1.32,
      reasoning: 1.32,
      cacheRead: 0.014,
      cacheWrite: 0,
    })
    const checkRef = { current: null }
    const sessionModelCache = new Map()

    function windowsFromResult(res) {
      if (res && Array.isArray(res.windows)) return res.windows
      const quota = res && res.quota
      if (!quota || typeof quota !== 'object') return []
      return [
        ['5h', quota.rolling],
        ['每周', quota.weekly],
        ['每月', quota.monthly],
      ].map(([label, value]) => {
        if (!value || typeof value !== 'object') return null
        return {
          label,
          percent: typeof value.percent === 'number' ? value.percent : null,
          status: typeof value.status === 'string' ? value.status : null,
          resetAt: typeof value.resetsAt === 'string' ? value.resetsAt : null,
        }
      }).filter((value) => value !== null)
    }

    function finiteOrNull(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    // The provider exposes the remaining monthly balance; the plan carries the monthly allotment.
    function commandCodeMonthlyWindow(report) {
      const credits = report && report.credits
      if (!credits || typeof credits !== 'object') return null
      const remaining = finiteOrNull(credits.monthlyCredits)
      if (remaining === null) return null
      const plan = report && report.plan
      const planLimit = plan && finiteOrNull(plan.monthlyCredits)
      const usage = report && report.usage
      const billedUsed = usage && finiteOrNull(usage.totalCredits)
      const periodEnd = plan && finiteOrNull(plan.currentPeriodEnd)
      if (planLimit !== null && planLimit > 0) {
        const used = Math.max(0, Math.min(planLimit, planLimit - remaining))
        return {
          label: '每月',
          used,
          limit: planLimit,
          percent: (used / planLimit) * 100,
          status: 'ok',
          resetAt: periodEnd,
          kind: 'monthly',
          remaining,
        }
      }
      if (billedUsed !== null && billedUsed + remaining > 0) {
        const limit = billedUsed + remaining
        return {
          label: '每月',
          used: Math.max(0, billedUsed),
          limit,
          percent: (Math.max(0, billedUsed) / limit) * 100,
          status: 'ok',
          resetAt: periodEnd,
          kind: 'monthly',
          remaining,
        }
      }
      return {
        label: '每月',
        used: null,
        limit: null,
        percent: null,
        status: 'ok',
        resetAt: periodEnd,
        kind: 'monthly',
        remaining,
        balanceOnly: true,
      }
    }

    function windowsFromCommandCodeReport(report) {
      const credits = report && report.credits
      if (!credits || typeof credits !== 'object') return []
      return [
        ['5h', credits.fiveHour],
        ['每周', credits.weekly],
      ].map(([label, value]) => {
        if (!value || typeof value !== 'object') return null
        const used = finiteOrNull(value.used)
        const limit = finiteOrNull(value.cap)
        if (used === null || limit === null) return null
        return {
          label,
          used,
          limit,
          percent: limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : null,
          status: value.exceeded === true ? 'exceeded' : 'ok',
          resetAt: finiteOrNull(value.resetAt),
          kind: 'credits',
        }
      }).concat(commandCodeMonthlyWindow(report) || []).filter((value) => value !== null)
    }

    function errorMessage(res) {
      const code = res && typeof res.error === 'string' ? res.error : ''
      if (code === 'NO_KEY') return '未找到 OpenCodeGo API Key，请先配置 OpenCodeGo 凭据'
      if (code === 'HTTP_401' || code === 'HTTP_403') return 'OpenCodeGo API Key 无效或已过期'
      if (code === 'HTTP_429') return 'OpenCodeGo 接口限流，请稍后重试'
      if (code.startsWith('NETWORK:')) return 'OpenCodeGo 接口连接失败，请稍后重试'
      return code || '查询失败'
    }

    function commandCodeErrorMessage(error) {
      const message = typeof error === 'string' ? error : ''
      if (message === 'COMMANDCODE_NO_KEY') {
        return '未找到 Command Code API Key，请先配置 Command Code 凭据'
      }
      if (message === 'COMMANDCODE_HTTP_401' || message === 'COMMANDCODE_HTTP_403') {
        return 'Command Code API Key 无效或已过期'
      }
      if (message === 'COMMANDCODE_HTTP_429') {
        return 'Command Code 接口限流，请稍后重试'
      }
      if (message.includes('MISSING_CREDENTIAL') || message.toLowerCase().includes('no api key')) {
        return '未找到 Command Code API Key，请先配置 Command Code 凭据'
      }
      return message || 'Command Code 查询失败'
    }

    function readSelectedProvider() {
      try {
        return window.localStorage.getItem(PROVIDER_STORAGE_KEY) === 'commandcode'
          ? 'commandcode'
          : 'opencodego'
      } catch {
        return 'opencodego'
      }
    }

    function rememberProvider(provider) {
      try {
        window.localStorage.setItem(PROVIDER_STORAGE_KEY, provider)
      } catch {
        // Private browsing and embedded views may disable local storage.
      }
    }

    function formatNum(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
      const v = Number(n)
      if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M'
      if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k'
      return String(Math.round(v * 100) / 100)
    }

    function formatCompact(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
      const v = Number(n)
      if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M'
      if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K'
      return String(Math.round(v))
    }

    function formatCost(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
      return '$' + Number(n).toFixed(2)
    }

    function tokenValue(tokens, key) {
      const value = tokens && tokens[key]
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    function tokenTotal(tokens) {
      return ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']
        .reduce((total, key) => total + tokenValue(tokens, key), 0)
    }

    function estimateCost(tokens) {
      return ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']
        .reduce((total, key) => total + tokenValue(tokens, key) * GO_PRICE_PER_MILLION[key], 0) / 1000000
    }

    function statsCost(stats) {
      if (stats && typeof stats.cost === 'number' && Number.isFinite(stats.cost)) return stats.cost
      return estimateCost(stats && stats.tokens)
    }

    function providerMatches(actual, expected) {
      if (actual === expected) return true
      return expected === 'commandcode'
        && typeof actual === 'string'
        && actual.startsWith('commandcode-')
    }

    function commandCodeModelTokens(value) {
      if (!value || typeof value !== 'object') return null
      const tokenBlock = value.tokens && typeof value.tokens === 'object' ? value.tokens : null
      const pick = (...keys) => {
        for (const key of keys) {
          const source = tokenBlock && Object.hasOwn(tokenBlock, key) ? tokenBlock : value
          const number = finiteOrNull(source[key])
          if (number !== null) return number
        }
        return null
      }
      const tokens = {
        input: pick('tokensIn', 'inputTokens', 'input'),
        output: pick('tokensOut', 'outputTokens', 'output'),
        reasoning: pick('reasoningTokens', 'reasoning'),
        cacheRead: pick('cacheReadTokens', 'cacheRead'),
        cacheWrite: pick('cacheWriteTokens', 'cacheWrite'),
      }
      return tokenTotal(tokens) > 0 ? tokens : null
    }

    function commandCodeModelStats(report) {
      const usage = report && report.usage
      const candidates = [
        report && report.byModel,
        report && report.models,
        usage && usage.byModel,
        usage && usage.models,
        usage && usage.modelUsage,
      ]
      for (const candidate of candidates) {
        const entries = Array.isArray(candidate)
          ? candidate
          : candidate && typeof candidate === 'object'
            ? Object.entries(candidate).map(([model, value]) => ({ model, ...(value && typeof value === 'object' ? value : {}) }))
            : []
        const stats = entries.map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : null
          const model = typeof entry.model === 'string' && entry.model.trim()
            ? entry.model.trim()
            : typeof entry.modelId === 'string' && entry.modelId.trim()
              ? entry.modelId.trim()
              : meta && typeof meta.model === 'string' && meta.model.trim()
                ? meta.model.trim()
                : null
          const tokens = commandCodeModelTokens(entry)
          const cost = finiteOrNull(entry.cost)
            ?? finiteOrNull(entry.totalCost)
            ?? finiteOrNull(entry.spend)
            ?? finiteOrNull(entry.credits)
          return model && tokens ? { model, tokens, cost } : null
        }).filter((value) => value !== null)
        if (stats.length > 0) {
          return stats.sort((a, b) => tokenTotal(b.tokens) - tokenTotal(a.tokens))
        }
      }
      return []
    }

    function modelName(model) {
      return String(model || '').replace(/^(?:opencode-go|commandcode)\//, '')
    }

    function usableStats(value) {
      if (!value || typeof value !== 'object' || value.error || !value.tokens || typeof value.tokens !== 'object') return null
      return value
    }

    function commandCodeStatsForReport(report, stats) {
      const usage = report && report.usage
      const tokens = stats && stats.tokens
      if (!usage || typeof usage !== 'object' || !tokens || typeof tokens !== 'object') return null
      const reportInput = finiteOrNull(usage.totalTokensIn)
      const reportOutput = finiteOrNull(usage.totalTokensOut)
      const localInput = finiteOrNull(tokens.input)
      const localOutput = finiteOrNull(tokens.output)
      const closeEnough = (left, right) => left === null || right === null
        ? left === right
        : Math.abs(left - right) <= Math.max(1000, Math.abs(left) * 0.01)
      return closeEnough(reportInput, localInput) && closeEnough(reportOutput, localOutput) ? stats : null
    }

    function commandCodeTokens(report, stats) {
      // Command Code's account report has input/output totals only; local session projections can add the other token fields.
      const usage = report && report.usage
      const fallbackTokens = stats && stats.tokens && tokenTotal(stats.tokens) > 0 ? stats.tokens : null
      const input = finiteOrNull(usage && usage.totalTokensIn) ?? finiteOrNull(fallbackTokens && fallbackTokens.input)
      const output = finiteOrNull(usage && usage.totalTokensOut) ?? finiteOrNull(fallbackTokens && fallbackTokens.output)
      if (input === null && output === null) return null
      const optionalToken = (key) => {
        const value = finiteOrNull(fallbackTokens && fallbackTokens[key])
        return value !== null && value > 0 ? value : null
      }
      return {
        input,
        output,
        reasoning: optionalToken('reasoning'),
        cacheRead: optionalToken('cacheRead'),
        cacheWrite: optionalToken('cacheWrite'),
      }
    }

    function commandCodePlanName(report) {
      const plan = report && report.plan
      if (!plan || typeof plan !== 'object') return null
      if (typeof plan.name === 'string' && plan.name.trim()) return plan.name.trim()
      if (typeof plan.planId === 'string' && plan.planId.trim()) return plan.planId.trim()
      return null
    }

    function emptyClientTokens() {
      return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    }

    function clientTokenValue(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    function tokensFromProjection(value) {
      if (!value || typeof value !== 'object') return emptyClientTokens()
      return {
        input: clientTokenValue(value.uncachedInputTokens),
        output: clientTokenValue(value.outputTokens),
        reasoning: 0,
        cacheRead: clientTokenValue(value.cacheReadTokens),
        cacheWrite: clientTokenValue(value.cacheWriteTokens),
      }
    }

    function addClientTokens(target, source) {
      for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']) {
        target[key] += clientTokenValue(source[key])
      }
    }

    function hasClientTokens(tokens) {
      return ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'].some((key) => tokens[key] > 0)
    }

    function fetchRpcValue(method, payload) {
      const rpcId = 'ocgo-tab-ring-' + method + '-' + Date.now() + '-' + Math.random().toString(16).slice(2)
      return fetch('/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        cache: 'no-store',
      })
        .then((r) => r.ok ? r.json() : null)
        .then((body) => body && body.result && body.result.ok ? body.result.value : null)
    }

    function currentModelFor(item, provider) {
      const sessionId = item && item.sessionId
      const updatedAt = item && item.updatedAt
      if (typeof sessionId !== 'string') return Promise.resolve(null)
      const cacheKey = provider + ':' + sessionId
      const cached = sessionModelCache.get(cacheKey)
      if (cached && cached.updatedAt === updatedAt) return Promise.resolve(cached.model)
      return fetchRpcValue('session.models', { sessionId })
        .then((value) => {
          const current = value && value.current
          const model = current && providerMatches(current.provider, provider) && typeof current.model === 'string'
            ? current.model
            : null
          sessionModelCache.set(cacheKey, { updatedAt, model })
          return model
        })
        .catch(() => {
          sessionModelCache.set(cacheKey, { updatedAt, model: null })
          return null
        })
    }

    function fetchSessionStats(provider = 'opencode-go') {
      return fetchRpcValue('session.list', {})
        .then((value) => {
          const items = value && Array.isArray(value.items) ? value.items : null
          if (!items) return null
          const rows = items.map((item) => {
            const projection = item && item.projections && item.projections.values
              && item.projections.values.tokenUsage
            return { item, tokens: tokensFromProjection(projection) }
          }).filter((row) => hasClientTokens(row.tokens))
          return Promise.all(rows.map((row) => currentModelFor(row.item, provider))).then((models) => {
            const tokens = emptyClientTokens()
            const modelBuckets = new Map()
            const bySession = []
            rows.forEach((row, index) => {
              const model = models[index]
              if (!model) return
              addClientTokens(tokens, row.tokens)
              const cost = provider === 'opencode-go' ? estimateCost(row.tokens) : null
              const modelId = provider + '/' + model
              bySession.push({
                sessionId: row.item.sessionId,
                mtime: typeof row.item.updatedAt === 'number' ? row.item.updatedAt : 0,
                tokens: row.tokens,
                cost,
                requests: 0,
                byModel: [{ model: modelId, tokens: { ...row.tokens }, cost, requests: 0 }],
              })
              const bucket = modelBuckets.get(model) || { tokens: emptyClientTokens(), cost: provider === 'opencode-go' ? 0 : null, requests: 0 }
              addClientTokens(bucket.tokens, row.tokens)
              if (cost !== null) bucket.cost += cost
              modelBuckets.set(model, bucket)
            })
            const byModel = [...modelBuckets.entries()]
              .map(([model, value]) => ({ model: provider + '/' + model, ...value }))
              .sort((a, b) => tokenTotal(b.tokens) - tokenTotal(a.tokens))
            return { tokens, cost: provider === 'opencode-go' ? estimateCost(tokens) : null, byModel, bySession }
          })
        })
        .catch(() => null)
    }

    function fetchLegacyStats() {
      return fetch(STATS_API, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((body) => usableStats(body && body.stats))
        .catch(() => null)
    }

    function fetchStats(usageRequest) {
      return usageRequest
        .then((body) => {
          const ownStats = usableStats(body && body.stats)
          return ownStats || fetchSessionStats().then((fallback) => fallback || fetchLegacyStats())
        })
        .catch(() => fetchSessionStats().then((fallback) => fallback || fetchLegacyStats()))
    }

    function formatReset(iso) {
      if (!iso) return null
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      const diff = d.getTime() - Date.now()
      if (diff <= 0) return '已重置'
      const day = Math.floor(diff / 86400e3)
      const hour = Math.floor((diff % 86400e3) / 3600e3)
      const minute = Math.floor((diff % 3600e3) / 60e3)
      if (day > 0) return day + '天 ' + hour + '小时'
      if (hour > 0) return hour + '小时 ' + minute + '分'
      return minute + '分钟'
    }

    function formatDate(value) {
      if (!value) return null
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString()
    }

    function stateOfRemaining(remPct) {
      if (remPct === null) return 'idle'
      if (remPct > 50) return 'ok'
      if (remPct > 20) return 'warn'
      return 'low'
    }

    function stateOfUsed(usedPct) {
      if (usedPct === null) return 'idle'
      if (usedPct >= 80) return 'low'
      if (usedPct >= 50) return 'warn'
      return 'ok'
    }

    function windowUsedPercent(windowValue) {
      if (!windowValue || typeof windowValue !== 'object') return null
      if (windowValue.status && windowValue.status !== 'ok') return 100
      if (typeof windowValue.percent === 'number' && Number.isFinite(windowValue.percent)) {
        return Math.max(0, Math.min(100, windowValue.percent))
      }
      if (typeof windowValue.limit === 'number' && windowValue.limit > 0 && typeof windowValue.used === 'number') {
        return Math.max(0, Math.min(100, (Math.max(0, windowValue.used) / windowValue.limit) * 100))
      }
      return null
    }

    function windowRemainingPercent(windowValue, usedPct) {
      if (windowValue && windowValue.status && windowValue.status !== 'ok') return 0
      return usedPct === null ? null : Math.max(0, 100 - usedPct)
    }

    function trackMouse(e) {
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      el.style.setProperty('--gx', x + '%')
      el.style.setProperty('--gy', y + '%')
    }

    function UsageRing({ percent, state }) {
      const radius = 5.5
      const circumference = 2 * Math.PI * radius
      const progress = Math.max(0, Math.min(100, percent))
      return React.createElement('svg', {
        className: 'ocgr-ring ocgr-ring-' + state,
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        'aria-hidden': true,
      },
        React.createElement('circle', {
          className: 'ocgr-ring-track',
          cx: 7,
          cy: 7,
          r: radius,
        }),
        React.createElement('circle', {
          className: 'ocgr-ring-fill',
          cx: 7,
          cy: 7,
          r: radius,
          strokeDasharray: `${circumference * progress / 100} ${circumference}`,
          transform: 'rotate(-90 7 7)',
        }),
      )
    }

    function UsageDot() {
      const [open, setOpen] = React.useState(false)
      const [provider, setProvider] = React.useState(readSelectedProvider)
      const [windows, setWindows] = React.useState([])
      const [error, setError] = React.useState('')
      const [stats, setStats] = React.useState(null)
      const [commandCodeStats, setCommandCodeStats] = React.useState(null)
      const [commandCodeReport, setCommandCodeReport] = React.useState(null)
      const [commandCodeError, setCommandCodeError] = React.useState('')
      const [commandCodeLoading, setCommandCodeLoading] = React.useState(false)
      const [panelPos, setPanelPos] = React.useState({ left: 0, bottom: 0 })
      const [pinned, setPinned] = React.useState(false)
      const triggerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const closeTimerRef = React.useRef(null)
      const commandCodeRequestRef = React.useRef(0)

      React.useEffect(() => {
        const host = triggerRef.current && triggerRef.current.closest('.ocgr-sidebar-host')
        if (!host) return undefined

        let frame = 0
        let observedSettingsButton = null
        const sync = () => {
          frame = 0
          const settingsButton = document.querySelector('[data-slot="sidebar.settings"] button')
          if (!settingsButton) return

          if (resizeObserver && settingsButton !== observedSettingsButton) {
            if (observedSettingsButton) resizeObserver.unobserve(observedSettingsButton)
            resizeObserver.observe(settingsButton)
            observedSettingsButton = settingsButton
          }

          const settingsRect = settingsButton.getBoundingClientRect()
          const hostRect = host.getBoundingClientRect()
          if (!settingsRect.height || !hostRect.height) return

          const desiredTop = settingsRect.top + (settingsRect.height - hostRect.height) / 2
          // Keep the host in the sidebar's existing absolute containing block
          // so its horizontal alignment and fixed child panel remain intact.
          const nextTop = host.offsetTop + desiredTop - hostRect.top
          host.style.top = `${nextTop}px`
          host.style.bottom = 'auto'
        }
        const schedule = () => {
          if (frame) return
          frame = window.requestAnimationFrame(sync)
        }

        const sidebar = host.closest('[data-slot="sidebar"]') || document.body
        const resizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(schedule)
          : null
        const mutationObserver = typeof MutationObserver === 'function'
          ? new MutationObserver(schedule)
          : null
        if (resizeObserver) {
          resizeObserver.observe(host)
          if (sidebar instanceof Element) resizeObserver.observe(sidebar)
        }
        if (mutationObserver && sidebar instanceof Element) {
          mutationObserver.observe(sidebar, { childList: true, subtree: true })
        }
        window.addEventListener('resize', schedule)
        schedule()

        return () => {
          window.removeEventListener('resize', schedule)
          if (frame) window.cancelAnimationFrame(frame)
          resizeObserver?.disconnect()
          mutationObserver?.disconnect()
        }
      }, [])

      function applyOpenCodeResult(res) {
        if (res && res.ok) {
          setWindows(windowsFromResult(res))
          setError('')
        } else {
          setError(errorMessage(res))
        }
      }

      function applyStatsResult(statsResult) {
        const nextStats = usableStats(statsResult)
        if (nextStats) setStats(nextStats)
      }

      function applyCommandCodeStatsResult(statsResult) {
        const nextStats = usableStats(statsResult)
        if (nextStats) setCommandCodeStats(nextStats)
      }

      function applyCommandCodeResult(res) {
        const result = res && res.commandCode
        if (result && result.ok && result.report && typeof result.report === 'object') {
          setCommandCodeReport(result.report)
          setCommandCodeError('')
          return
        }
        setCommandCodeError(commandCodeErrorMessage(result && result.error))
      }

      function doCheck() {
        const requestId = commandCodeRequestRef.current + 1
        commandCodeRequestRef.current = requestId
        setCommandCodeLoading(true)
        const usageRequest = fetch(USAGE_API, { cache: 'no-store' })
          .then((r) => {
            if (!r.ok) return { ok: false, error: 'HTTP_' + r.status }
            return r.json()
          })
          .catch((e) => ({
            ok: false,
            error: 'NETWORK:' + String((e && e.message) || e),
          }))
        const quotaRequest = usageRequest
        const statsRequest = fetchStats(usageRequest)
        const commandCodeStatsRequest = fetchSessionStats('commandcode')
        quotaRequest.then(applyOpenCodeResult)
        quotaRequest.then((result) => {
          if (commandCodeRequestRef.current !== requestId) return
          applyCommandCodeResult(result)
          setCommandCodeLoading(false)
        })
        statsRequest.then(applyStatsResult)
        commandCodeStatsRequest.then(applyCommandCodeStatsResult)
      }
      checkRef.current = doCheck

      React.useEffect(() => {
        doCheck()
      }, [])

      React.useEffect(() => {
        const id = window.setInterval(() => {
          if (checkRef.current) checkRef.current()
        }, 120000)
        return () => window.clearInterval(id)
      }, [])

      // Match ContextMeter's menu behavior: the trigger and panel keep the
      // surface open, while a pointer outside the component closes it.
      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (e) => {
          if (e.target instanceof Node && triggerRef.current?.contains(e.target)) return
          if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
          clearCloseTimer()
          setPinned(false)
          setOpen(false)
        }
        const onKeyDown = (e) => {
          if (e.key !== 'Escape') return
          clearCloseTimer()
          setPinned(false)
          setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      React.useEffect(() => {
        if (!open) return
        const onResize = () => positionPanel()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [open])

      function clearCloseTimer() {
        if (closeTimerRef.current !== null) {
          window.clearTimeout(closeTimerRef.current)
          closeTimerRef.current = null
        }
      }

      function positionPanel() {
        const rect = triggerRef.current && triggerRef.current.getBoundingClientRect()
        if (rect) {
          const width = Math.min(300, Math.max(0, window.innerWidth - 16))
          const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
          // Touch the trigger's top edge so moving the pointer from the
          // trigger into the fixed panel does not cross a dead gap.
          const bottom = Math.max(8, window.innerHeight - rect.top)
          setPanelPos({ left, bottom })
        }
      }

      function openPanel() {
        clearCloseTimer()
        positionPanel()
        setOpen(true)
      }

      function closePanel() {
        clearCloseTimer()
        setOpen(false)
      }

      function scheduleClose() {
        clearCloseTimer()
        if (pinned) return
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null
          closePanel()
        }, 650)
      }

      function keepPanelOpen() {
        clearCloseTimer()
      }

      function toggle() {
        if (open && pinned) {
          setPinned(false)
          closePanel()
          return
        }
        setPinned(true)
        openPanel()
      }

      function selectProvider(nextProvider) {
        if (nextProvider === provider) return
        setProvider(nextProvider)
        rememberProvider(nextProvider)
        if (nextProvider === 'commandcode' && !commandCodeReport) doCheck()
        if (nextProvider === 'opencodego' && windows.length === 0) doCheck()
      }

      const isCommandCode = provider === 'commandcode'
      const activeWindows = isCommandCode ? windowsFromCommandCodeReport(commandCodeReport) : windows
      const activeError = isCommandCode ? commandCodeError : error
      const activeLoading = isCommandCode && commandCodeLoading
      const usedPcts = activeWindows
        .map((w) => ({ w, pct: windowUsedPercent(w) }))
        .filter((x) => x.pct !== null)
      const highestUsed = usedPcts.length ? usedPcts.reduce((a, b) => (b.pct > a.pct ? b : a)) : null
      const usedPct = highestUsed ? Math.round(highestUsed.pct) : null
      const state = usedPct === null && activeError ? 'err' : stateOfUsed(usedPct)
      const ringProgress = usedPct === null ? (state === 'err' ? 25 : 0) : usedPct
      const tokenStats = usableStats(stats)
      const commandCodeLocalStats = usableStats(commandCodeStats)
      const commandCodeTokenStats = commandCodeStatsForReport(commandCodeReport, commandCodeLocalStats)
      const activeStats = isCommandCode ? commandCodeLocalStats : tokenStats
      const activeTokenStatsValues = isCommandCode
        ? commandCodeTokens(commandCodeReport, commandCodeTokenStats)
        : tokenStats ? tokenStats.tokens : null
      const activeUsage = isCommandCode && commandCodeReport && commandCodeReport.usage && typeof commandCodeReport.usage === 'object'
        ? commandCodeReport.usage
        : null
      const activeCost = isCommandCode
        ? finiteOrNull(activeUsage && activeUsage.totalCost) ?? (commandCodeTokenStats ? statsCost(commandCodeTokenStats) : null)
        : tokenStats ? statsCost(tokenStats) : null
      const commandAccount = isCommandCode && commandCodeReport && commandCodeReport.account
        && typeof commandCodeReport.account === 'object'
        ? commandCodeReport.account
        : null
      const commandPlan = isCommandCode && commandCodeReport && commandCodeReport.plan
        && typeof commandCodeReport.plan === 'object'
        ? commandCodeReport.plan
        : null
      const commandAccountLabel = commandAccount
        ? commandAccount.userName || commandAccount.name || null
        : null
      const commandPeriodEnd = commandPlan && finiteOrNull(commandPlan.currentPeriodEnd)
      const commandPlanStatus = commandPlan && typeof commandPlan.status === 'string'
        && commandPlan.status && commandPlan.status !== 'active'
        ? commandPlan.status
        : null
      const localModelStats = activeStats && Array.isArray(activeStats.byModel)
        ? activeStats.byModel.filter((value) => value && typeof value.model === 'string' && value.tokens && tokenTotal(value.tokens) > 0)
        : []
      const reportedModelStats = isCommandCode ? commandCodeModelStats(commandCodeReport) : []
      const singleLocalModel = localModelStats.length === 1 ? localModelStats[0] : null
      let modelStats = localModelStats
      if (isCommandCode) {
        if (reportedModelStats.length > 0) {
          modelStats = reportedModelStats
        } else if (commandCodeTokenStats && singleLocalModel && activeTokenStatsValues) {
          modelStats = [{
            model: singleLocalModel.model,
            tokens: activeTokenStatsValues,
            cost: activeCost,
            requests: finiteOrNull(activeUsage && activeUsage.totalCount),
          }]
        } else if (commandCodeTokenStats && localModelStats.length > 0) {
          modelStats = localModelStats
        } else {
          modelStats = []
        }
      }
      const modelBreakdownUnavailable = isCommandCode
        && modelStats.length === 0
        && Boolean(activeTokenStatsValues)
      const modelSectionStats = modelStats.length > 0
        ? modelStats
        : modelBreakdownUnavailable
          ? [{ model: '总计', tokens: activeTokenStatsValues, cost: activeCost }]
          : []
      const providerTitle = isCommandCode ? 'Command Code' : 'OpenCodeGo'
      const planName = isCommandCode ? commandCodePlanName(commandCodeReport) : null
      const showError = Boolean(activeError && usedPct === null && !activeTokenStatsValues)
      const label = showError ? providerTitle + ' 查询失败'
        : usedPct === null ? providerTitle + ' 用量'
          : providerTitle + ' 已用额度 ' + usedPct + '%'
      const statusText = usedPct === null
        ? activeLoading ? '读取中' : showError ? '查询失败' : '未配置'
        : '已用 ' + usedPct + '%'
      const panelVisible = open
      const tokenFields = [['输入', 'input'], ['输出', 'output'], ['推理', 'reasoning'], ['缓存读', 'cacheRead'], ['缓存写', 'cacheWrite']]
      const panel = panelVisible ? React.createElement('div', {
        className: 'ocgr-panel',
        ref: panelRef,
        role: 'dialog',
        'aria-label': providerTitle + ' 用量',
        style: { left: panelPos.left, bottom: panelPos.bottom },
        onMouseMove: trackMouse,
        onMouseEnter: keepPanelOpen,
        onMouseLeave: scheduleClose,
      },
        React.createElement('div', { className: 'ocgr-header' },
          React.createElement('button', {
            type: 'button',
            className: 'ocgr-switch',
            'aria-label': '切换到 OpenCodeGo',
            title: '切换到 OpenCodeGo',
            disabled: !isCommandCode,
            onClick: () => selectProvider('opencodego'),
          }, '←'),
          React.createElement('span', {
            className: 'ocgr-headline',
            title: planName ? providerTitle + ' · ' + planName : providerTitle,
          }, planName ? providerTitle + ' · ' + planName : providerTitle),
          React.createElement('button', {
            type: 'button',
            className: 'ocgr-switch',
            'aria-label': '切换到 Command Code',
            title: '切换到 Command Code',
            disabled: isCommandCode,
            onClick: () => selectProvider('commandcode'),
          }, '→'),
          React.createElement('span', { className: 'ocgr-percent' }, statusText),
        ),
        isCommandCode && (commandAccountLabel || commandPlanStatus) && React.createElement('div', { className: 'ocgr-commandMeta' },
          React.createElement('span', { className: 'ocgr-commandMetaMain' },
            [commandAccountLabel, commandPlanStatus].filter(Boolean).join(' · ')),
          commandPeriodEnd > 0 && React.createElement('span', { className: 'ocgr-commandMetaEnd' }, '账期 ' + formatDate(commandPeriodEnd)),
        ),
        activeWindows.length > 0 && React.createElement('div', { className: 'ocgr-rows' },
          activeWindows.map((w) => {
            const rowUsedPct = windowUsedPercent(w)
            const remP = windowRemainingPercent(w, rowUsedPct)
            const rowState = stateOfRemaining(remP)
            const wColor = rowState === 'ok' ? 'var(--dsw-alias-state-success-primary, #3fb950)'
              : rowState === 'warn' ? 'var(--dsw-alias-state-warn-primary, #d29922)'
                : rowState === 'low' ? 'var(--dsw-alias-state-error-primary, #f66)'
                  : 'var(--dsw-alias-label-tertiary, #777)'
            const reset = formatReset(w.resetAt)
            const meta = w.kind === 'monthly' && w.balanceOnly
              ? '余额 ' + formatNum(w.remaining)
              : w.kind === 'credits' || w.kind === 'monthly'
              ? rowUsedPct === null ? '额度暂无数据' : '已用 ' + formatNum(w.used) + ' / ' + formatNum(w.limit) + ' · ' + Math.round(rowUsedPct) + '%'
              : typeof w.percent === 'number'
                ? '已用 ' + Math.round(rowUsedPct) + '% · 剩余 ' + Math.round(remP) + '%'
                : typeof w.limit === 'number' && w.limit > 0
                  ? '已用 ' + formatNum(w.used) + ' / ' + formatNum(w.limit) + ' · 剩余 ' + formatNum(Math.max(0, w.limit - w.used))
                  : '额度暂无数据'
            const resetLabel = reset
              ? '重置 ' + reset
              : w.kind === 'monthly'
                ? '账期内'
                : '滚动窗口'
            return React.createElement('div', { className: 'ocgr-win', key: w.label + (w.resetAt || '') + (w.percent !== undefined ? w.percent : '') + (w.used || '') },
              React.createElement('div', { className: 'ocgr-winTop' },
                React.createElement('span', { className: 'ocgr-winLabel' }, w.label),
                React.createElement('span', { className: 'ocgr-winMeta' }, meta),
                React.createElement('span', { className: 'ocgr-winReset' }, resetLabel),
              ),
              React.createElement('div', { className: 'ocgr-bar' },
                React.createElement('div', { className: 'ocgr-segment', style: { width: (rowUsedPct ?? 0) + '%', background: wColor } })),
            )
          }),
        ),
        activeTokenStatsValues && React.createElement('div', { className: 'ocgr-tokenSection' },
          React.createElement('div', { className: 'ocgr-tokenTitle' },
            React.createElement('span', null, '总消耗 token'),
            React.createElement('span', { className: 'ocgr-tokenTotal' },
              formatCompact(tokenTotal(activeTokenStatsValues)) + ' · ' + formatCost(activeCost))),
          React.createElement('div', { className: 'ocgr-tokenRows' },
            tokenFields.map(([label, key]) => React.createElement(
              'div',
              { className: 'ocgr-tokenRow', key },
              React.createElement('span', { className: 'ocgr-tokenLabel' }, label + ':'),
              React.createElement('span', { className: 'ocgr-tokenValue' }, formatCompact(activeTokenStatsValues[key])),
            )),
          ),
        ),
        modelSectionStats.length > 0 && React.createElement('div', { className: 'ocgr-models' },
            React.createElement('div', { className: 'ocgr-modelTitle' }, '按模型'),
            modelSectionStats.map((value) => {
              const modelTokens = value.tokens
              const modelCost = typeof value.cost === 'number' && Number.isFinite(value.cost)
                ? value.cost
                : isCommandCode ? null : estimateCost(modelTokens)
              return React.createElement('div', { className: 'ocgr-modelRow', key: value.model },
                React.createElement('div', { className: 'ocgr-modelTop' },
                  React.createElement('span', { className: 'ocgr-modelName', title: modelName(value.model) }, modelName(value.model)),
                  React.createElement('span', { className: 'ocgr-modelMeta' },
                    formatCompact(tokenTotal(modelTokens)) + ' · ' + formatCost(modelCost))),
                React.createElement('span', { className: 'ocgr-modelDetail' },
                  '输入 ' + formatCompact(modelTokens.input)
                  + ' · 输出 ' + formatCompact(modelTokens.output)
                  + ' · 缓存读 ' + formatCompact(modelTokens.cacheRead)),
              )
            }),
        ),
        ...(showError ? [React.createElement('div', { className: 'ocgr-error', role: 'alert', key: 'err' }, activeError)] : []),
        ...(activeLoading && activeWindows.length === 0 && !activeTokenStatsValues
          ? [React.createElement('div', { className: 'ocgr-loading', key: 'loading' }, '正在读取 Command Code 数据…')]
          : []),
      ) : null

      return React.createElement('div', {
        className: 'ocgr-root',
        ref: triggerRef,
        onMouseEnter: openPanel,
        onMouseLeave: scheduleClose,
      },
        React.createElement('button', {
          type: 'button',
          className: 'ocgr-trigger',
          'aria-label': label,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: label,
          onClick: toggle,
          onFocus: openPanel,
          onBlur: scheduleClose,
        },
          React.createElement(UsageRing, { percent: ringProgress, state }),
        ),
        panel,
      )
    }

    function apply(ctx) {
      const tag = document.createElement('style')
      tag.textContent = CSS
      document.head.append(tag)
      ctx.effect(() => () => tag.remove(), 'ocgo-tab-ring: css')

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'ocgo-tab-ring',
        label: 'OpenCodeGo usage',
      }, ({ wide }) => wide
        ? React.createElement('div', { className: 'ocgr-sidebar-host' },
          React.createElement(UsageDot),
        )
        : null))
    }

    module.exports = { apply, inject }
    return module.exports
  },
})
