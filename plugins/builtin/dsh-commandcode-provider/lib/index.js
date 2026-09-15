import { homedir } from "node:os";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { CallId, LlmAdapter, LlmError, ReasoningEffortId, assertUsableApiKey, attributionHeaders, errorChain, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/accounts.ts
/**
* Multi-account pool for the Command Code provider (host side).
*
* One Command Code subscription (e.g. the Go plan's 5-hour window) is
* metered; a user with several subscriptions wants a request that hits one
* account's limit to continue on the next account without a visible failure.
* This module owns that rotation:
*
*   - {@link CommandCodeAccountPool.resolveKey} hands out the first account
*     whose key is not currently marked exhausted, resolving each slot's key
*     lazily (literal config key → credential seam → launch environment → the
*     official CLI auth file for the default slot only).
*   - {@link CommandCodeAccountPool.markRejected} records a 429 (rate limit,
*     window unknown) or 401 (invalid key, disabled until the config changes)
*     against the exact API key, so several slots sharing one key share one
*     state.
*   - When every account is marked, the pool probes each key's
*     `/alpha/billing/credits` window limits (through the injected
*     {@link CommandCodeAccountPoolDeps.probeWindow}): an account whose window
*     no longer reports `exceeded` is revived, otherwise the pool throws a
*     `RATE_LIMIT` error naming the earliest reset time.
*
* The pool is deliberately cordis-free (like the adapter): every host fact
* arrives through injected thunks, so node tests can drive it directly.
*
* @module dsh-commandcode-provider/accounts
*/
/**
* Upper bound on the retry wait this pool attaches to the all-exhausted
* `RATE_LIMIT` error. Must equal the `backoff.maxDelayMs` in the adapter's
* `providerRetryPolicy` (which imports it from here): dsh-llm-retry honors a
* provider-specified wait verbatim only at or below that cap — in normal mode
* a LONGER attached wait makes the executor abandon the retry entirely
* instead of falling back to local backoff, which would turn "poll until the
* window opens" into "fail now".
*/
const RETRY_MAX_DELAY_MS = 9e5;
/** A labeled, human-readable clock reading for error messages. */
function clockLabel(ms) {
	return new Date(ms).toLocaleString();
}
/**
* Whether an account with this rotation state can serve a request right now.
* `undefined` (never rejected) is usable; a cooldown becomes usable again
* once its reset time passes; `unknown` (429, reset unprobed) and
* `disabled` (401) are not.
*/
function accountUsable(state) {
	if (state === void 0) return true;
	if (state.kind === "cooldown") return state.until > 0 && Date.now() >= state.until;
	return false;
}
/**
* Pick the account that should serve now: the manually preferred slot when it
* is usable, otherwise the first usable account in rotation order; undefined
* when no account is usable. Shared by the pool (request path) and the plugin
* entry (the usage view's active badge) so both always agree.
*/
function selectActiveAccount(accounts, preferredId) {
	const usable = accounts.filter((account) => accountUsable(account.state));
	if (preferredId !== void 0) {
		const preferred = usable.find((account) => account.slot.id === preferredId);
		if (preferred !== void 0) return preferred;
	}
	return usable[0];
}
/**
* The account pool. Rotation state is keyed by API key (never logged), so two
* slots resolving to the same credential share one mark, and a key changed in
* the credentials service starts with a clean slate.
*/
var CommandCodeAccountPool = class {
	deps;
	/** Rotation state by API key. */
	states = /* @__PURE__ */ new Map();
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Resolve every slot's key, deduplicated by key (first slot wins). Slots
	* without any resolvable key are omitted — they still appear in the
	* settings page as unconfigured, they just cannot serve requests.
	*/
	async resolvedAccounts() {
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const slot of this.deps.slots()) {
			const key = await this.resolveSlotKey(slot);
			if (key === void 0 || seen.has(key)) continue;
			seen.add(key);
			out.push({
				slot,
				key,
				state: this.states.get(key)
			});
		}
		return out;
	}
	/**
	* Every slot paired with its resolved key and rotation state — NOT
	* deduplicated: two slots sharing one credential both appear (the usage
	* view reports them individually), while slots without any resolvable key
	* are omitted. The serving path uses {@link resolvedAccounts} instead.
	*/
	async describeAccounts() {
		const out = [];
		for (const slot of this.deps.slots()) {
			const key = await this.resolveSlotKey(slot);
			if (key === void 0) continue;
			out.push({
				slot,
				key,
				state: this.states.get(key)
			});
		}
		return out;
	}
	/**
	* Hand out the first usable account's key (the manually preferred account
	* when usable, else rotation order). Returns `undefined` when no account
	* resolves any key at all (the caller then reports the missing credential).
	* Throws `RATE_LIMIT` — naming the earliest window reset — or
	* `INVALID_CREDENTIAL` when accounts exist but none can serve.
	*
	* `options.exclude` skips one key during the probe-revival pass: the
	* rotation hook excludes the just-rejected key so a probe that clears its
	* window cannot re-offer the same key within the same request (the adapter
	* refuses already-tried keys; the next request picks the revived key up).
	*/
	async resolveKey(options) {
		const accounts = await this.resolvedAccounts();
		if (accounts.length === 0) return;
		const chosen = selectActiveAccount(accounts, this.deps.preferredId?.());
		if (chosen !== void 0) return this.pick(chosen);
		await Promise.all(accounts.map(async (account) => {
			if (account.state?.kind === "disabled") return;
			if (options?.exclude !== void 0 && account.key === options.exclude) return;
			const probe = await this.deps.probeWindow(account.key);
			if (probe === void 0) return;
			if (!probe.exceeded) this.states.delete(account.key);
			else this.states.set(account.key, {
				kind: "cooldown",
				reason: account.state?.reason ?? "rate limited (429)",
				until: probe.resetAt
			});
		}));
		const revived = selectActiveAccount(await this.resolvedAccounts(), this.deps.preferredId?.());
		if (revived !== void 0) return this.pick(revived);
		const latest = await this.resolvedAccounts();
		if (latest.filter((account) => account.state?.kind === "disabled").length === latest.length) throw new LlmError(`llm-commandcode: every configured Command Code account (${latest.length}) was rejected with 401 — check the stored API keys (Models page / settings) or the auth file`, "INVALID_CREDENTIAL");
		const resets = latest.map((account) => account.state).filter((state) => state !== void 0 && state.kind === "cooldown" && state.until > 0).map((state) => state.until);
		const earliest = resets.length > 0 ? Math.min(...resets) : 0;
		const wait = earliest > 0 ? Math.max(1e3, earliest - Date.now()) : 0;
		throw new LlmError(`llm-commandcode: all ${latest.length} Command Code account(s) have exhausted their usage window` + (earliest > 0 ? `; the earliest window resets at ${clockLabel(earliest)}` : "") + " — requests will succeed again after the reset (or add another account)", "RATE_LIMIT", wait > 0 && wait <= 9e5 ? { providerRetryAfterMs: wait } : void 0);
	}
	/**
	* Record a rejection against one key. `rate-limit` (429) marks the key
	* exhausted with an unknown reset (probed lazily at the next resolution
	* once every account is marked); `invalid-credential` (401) disables the
	* key until the stored credential changes.
	*/
	markRejected(apiKey, rejection) {
		if (rejection === "invalid-credential") this.states.set(apiKey, {
			kind: "disabled",
			reason: "invalid API key (401)",
			until: 0
		});
		else this.states.set(apiKey, {
			kind: "unknown",
			reason: "rate limited (429)",
			until: 0
		});
	}
	/** One account's key: literal → credential seam → auth file (default slot). */
	async resolveSlotKey(slot) {
		if (slot.literal !== void 0 && slot.literal !== "") return slot.literal;
		if (slot.ref !== void 0) {
			const hit = await this.deps.resolveRef(slot.ref);
			if (hit !== void 0 && hit !== "") return hit;
		}
		if (slot.allowAuthFile) {
			const fromFile = this.deps.authFileKey();
			if (fromFile !== void 0 && fromFile !== "") return fromFile;
		}
	}
	/** Hand out the chosen account's key. */
	pick(account) {
		return {
			key: account.key,
			slot: account.slot
		};
	}
};
//#endregion
//#region src/adapter.ts
/**
* DeepSeek Harness LLM adapter for the Command Code Provider API.
*
* Ported from pi-commandcode-provider@0.5.1 (MIT). This is an unofficial,
* community-maintained integration; you need your own Command Code account
* and API key or subscription, and Command Code's terms apply.
*
* Wire protocol (reverse-engineered by the pi plugin, command-code@1.28.4;
* re-verified against command-code@1.31.0 — endpoints, request shape, and
* stream events unchanged):
*   POST {apiBase}/alpha/generate
*   body: { config, memory, taste, skills, params: { model, messages, tools,
*          system, max_tokens, temperature, stream, reasoning_effort? }, threadId }
*   SSE-ish JSONL events: text-delta | reasoning-start/delta/end | tool-call
*                         | tool-result | finish | error
*   Model catalog: GET {apiBase}/provider/v1/models -> { object: 'list', data: [...] }
*
* The adapter is deliberately free of cordis/schemastery: it receives a
* per-request options thunk and an API-key resolver from the plugin entry
* (src/index.ts), so a settings change reaches the very next request.
*/
const KNOWN_EFFORTS = {
	"Qwen/Qwen3.8-Max": [
		"low",
		"medium",
		"xhigh"
	],
	"Qwen/Qwen3.8-27B": [
		"low",
		"medium",
		"xhigh"
	],
	"claude-fable-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-4-7": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-4-8": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-opus-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-sonnet-4-6": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"claude-sonnet-5": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"deepseek/deepseek-v4-flash": ["high", "max"],
	"deepseek/deepseek-v4-pro": ["high", "max"],
	"google/gemini-3.1-flash-lite": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.5-flash": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.5-flash-lite": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.6-flash": [
		"low",
		"medium",
		"high"
	],
	"google/gemini-3.7-flash": [
		"low",
		"medium",
		"high"
	],
	"gpt-5.3-codex": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.4": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.4-mini": [
		"low",
		"medium",
		"high"
	],
	"gpt-5.5": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"gpt-5.6-luna": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-5.6-sol": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"gpt-5.6-terra": [
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	"sakana/fugu-ultra": ["high", "xhigh"],
	"xai/grok-4.5": [
		"low",
		"medium",
		"high"
	],
	"xai/grok-4.6": [
		"low",
		"medium",
		"high",
		"xhigh"
	],
	"zai-org/GLM-5.2": ["high", "max"],
	"zai-org/GLM-5.3": [
		"low",
		"high",
		"max"
	]
};
let masterEffortsCache;
/**
* Reasoning-effort resolution with the master catalog as fallback (change M01):
* `product/config/model-catalog.json` `models[id].reasoningEfforts` (derived
* from the models.dev reasoning_options, vendor entry first). KNOWN_EFFORTS —
* the command-code CLI table, verified against the wire protocol — stays the
* override; the catalog only fills models the CLI table does not list yet
* (e.g. `deepseek/deepseek-v4-flash-vision-exp`). The `off` key (null value)
* is not a selectable level here: the picker already offers the provider
* default, and `stream()` drops "off" at the request guard.
*/
async function effortsForModel(model) {
	const known = KNOWN_EFFORTS[model];
	if (known) return known;
	if (masterEffortsCache === void 0) {
		masterEffortsCache = {};
		const candidates = [
			new URL("./model-catalog.json", import.meta.url),
			new URL("../../../../product/config/model-catalog.json", import.meta.url)
		];
		for (const url of candidates) {
			if (Object.keys(masterEffortsCache).length > 0) break;
			try {
				const response = await fetch(url);
				if (response.ok) {
					const json = await response.json();
					if (json && typeof json.models === "object" && json.models !== null) masterEffortsCache = json.models;
					continue;
				}
			} catch {}
			try {
				const { readFileSync } = await import("node:fs");
				const { fileURLToPath } = await import("node:url");
				const json = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
				if (json && typeof json.models === "object" && json.models !== null) masterEffortsCache = json.models;
			} catch {}
		}
	}
	const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
	const entry = masterEffortsCache[model] ?? masterEffortsCache[bare];
	const efforts = entry && typeof entry.reasoningEfforts === "object" && entry.reasoningEfforts !== null
		? Object.keys(entry.reasoningEfforts).filter((id) => id !== "off" && entry.reasoningEfforts[id] !== null && entry.reasoningEfforts[id] !== void 0)
		: void 0;
	return efforts !== void 0 && efforts.length > 0 ? efforts : void 0;
}
/**
* Models whose Capabilities include Vision, per the official Command Code
* model registry (`https://commandcode.ai/docs/reference/cli/models`, generated
* from the same registry as `cmd --list-models` / the `/model` picker).
*
* The Provider API does not expose modality metadata, so this snapshot is the
* source of truth for image-input gating. Command Code's own CLI falls back to
* a client-side VISION side-call for text-only models; this adapter does not
* reproduce that interactive feature, so images sent to a model outside this
* list are refused loudly (`UNSUPPORTED_CONTENT`) instead of being dropped or
* sent to a model that cannot read them.
*
* Keep in sync with the official registry when new models ship (see the
* dsh-commandcode-upstream skill).
*/
const KNOWN_IMAGE_MODELS = /* @__PURE__ */ new Set([
	"deepseek-v4-flash-vision-exp",
	"deepseek/deepseek-v4-flash-vision-exp",
	"deepseek-v4-flash-vision",
	"deepseek/deepseek-v4-flash-vision",
	"MiniMaxAI/MiniMax-M3",
	"Qwen/Qwen3.6-Plus",
	"Qwen/Qwen3.7-Flash",
	"Qwen/Qwen3.7-Plus",
	"Qwen/Qwen3.8-27B",
	"Qwen/Qwen3.8-Max",
	"claude-fable-5",
	"claude-haiku-4-5-20251001",
	"claude-opus-4-7",
	"claude-opus-4-8",
	"claude-opus-5",
	"claude-sonnet-4-6",
	"claude-sonnet-5",
	"google/gemini-3.1-flash-lite",
	"google/gemini-3.5-flash",
	"google/gemini-3.5-flash-lite",
	"google/gemini-3.6-flash",
	"google/gemini-3.7-flash",
	"gpt-5.3-codex",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.5",
	"gpt-5.6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"meta/muse-spark-1.1",
	"meta/muse-spark-1.2",
	"meta/muse-spark-1.2-contributor",
	"moonshotai/Kimi-K2.5",
	"moonshotai/Kimi-K2.6",
	"moonshotai/Kimi-K2.7-Code",
	"moonshotai/Kimi-K2.7-Code-Highspeed",
	"moonshotai/Kimi-K3",
	"sakana/fugu-ultra",
	"stealth/ox-alpha",
	"stepfun/Step-3.7-Flash",
	"thinkingmachines/inkling",
	"thinkingmachines/inkling-small",
	"xai/grok-4.5",
	"xiaomi/mimo-v2.5"
]);
/**
* Models the official CLI's model table (`ZA` in command-code@1.31.0) marks
* `reasoning:!0` but defines no selectable `reasoning_effort` levels — they
* think automatically, with Command Code driving the depth. This is the
* authoritative "thinks, effort not adjustable" set: `KNOWN_EFFORTS` (which
* mirrors the CLI's effort map exactly) stays the sole source for selectable
* effort levels, and this snapshot is not surfaced in the picker's compact
* description — it exists for programmatic consumers.
*
* Source: the command-code@1.31.0 bundled model table (dist/cli.mjs, the `ZA`
* object), cross-checked with https://commandcode.ai/docs/reference/cli/models.
* Keep in sync via the dsh-commandcode-upstream skill.
*/
const KNOWN_THINKING_MODELS = /* @__PURE__ */ new Set([
	"MiniMaxAI/MiniMax-M3",
	"Qwen/Qwen3.6-Max-Preview",
	"Qwen/Qwen3.6-Plus",
	"Qwen/Qwen3.7-Flash",
	"Qwen/Qwen3.7-Max",
	"Qwen/Qwen3.7-Plus",
	"moonshotai/Kimi-K3",
	"moonshotai/Kimi-K2.7-Code",
	"moonshotai/Kimi-K2.7-Code-Highspeed",
	"stepfun/Step-3.5-Flash",
	"stepfun/Step-3.7-Flash",
	"tencent/hy3-paid",
	"nvidia/nemotron-3-ultra-550b-a55b",
	"thinkingmachines/inkling",
	"thinkingmachines/inkling-small",
	"poolside/laguna-s-2.1-free",
	"meta/muse-spark-1.1",
	"meta/muse-spark-1.2",
	"meta/muse-spark-1.2-contributor",
	"stealth/ox-alpha"
]);
/**
* The minimum subscription plan a model is included in, per the official plan
* pages (`/docs/plans/go`, `/docs/plans/goat`, `/docs/plans/pro`, `/docs/plans/max`
* and `/docs/resources/pricing-limits`). Each plan's model list is a superset of
* the one below it: Go ⊂ GOAT ⊂ Pro ⊂ Provider/Max. Models absent from every
* plan list (Claude Opus/Fable, Fugu Ultra) are Provider-tier.
*
* The Provider API exposes no plan metadata, so this snapshot is the source of
* truth for the picker's plan annotation — it answers "which plan do I need to
* actually use this model?" at a glance. Plan labels use the official tier
* names (`Go`, `GOAT`, `Pro`, `Provider`), with `Max` implying Provider.
*
* Keep in sync with the official plan pages when they change (see the
* dsh-commandcode-upstream skill).
*/
const KNOWN_PLANS = {
	"MiniMaxAI/MiniMax-M2.5": "go",
	"MiniMaxAI/MiniMax-M2.7": "go",
	"MiniMaxAI/MiniMax-M3": "go",
	"Qwen/Qwen3.6-Max-Preview": "go",
	"Qwen/Qwen3.6-Plus": "go",
	"Qwen/Qwen3.7-Flash": "go",
	"Qwen/Qwen3.7-Max": "go",
	"Qwen/Qwen3.7-Plus": "go",
	"Qwen/Qwen3.8-27B": "go",
	"Qwen/Qwen3.8-Max": "go",
	"deepseek/deepseek-v4-flash": "go",
	"deepseek/deepseek-v4-pro": "go",
	"gpt-5.6-luna": "go",
	"meta/muse-spark-1.2-contributor": "go",
	"moonshotai/Kimi-K2.5": "go",
	"moonshotai/Kimi-K2.6": "go",
	"moonshotai/Kimi-K2.7-Code": "go",
	"moonshotai/Kimi-K2.7-Code-Highspeed": "go",
	"moonshotai/Kimi-K3": "go",
	"nvidia/nemotron-3-ultra-550b-a55b": "go",
	"poolside/laguna-s-2.1-free": "go",
	"stealth/ox-alpha": "go",
	"stepfun/Step-3.5-Flash": "go",
	"stepfun/Step-3.7-Flash": "go",
	"tencent/hy3-paid": "go",
	"thinkingmachines/inkling": "go",
	"thinkingmachines/inkling-small": "go",
	"xai/grok-4.5": "go",
	"xiaomi/mimo-v2.5": "go",
	"xiaomi/mimo-v2.5-pro": "go",
	"zai-org/GLM-5": "go",
	"zai-org/GLM-5.1": "go",
	"zai-org/GLM-5.2": "go",
	"zai-org/GLM-5.2-Fast": "go",
	"zai-org/GLM-5.3": "go",
	"google/gemini-3.7-flash": "goat",
	"gpt-5.6-sol": "goat",
	"meta/muse-spark-1.2": "goat",
	"xai/grok-4.6": "goat",
	"claude-haiku-4-5-20251001": "pro",
	"claude-sonnet-4-6": "pro",
	"claude-sonnet-5": "pro",
	"google/gemini-3.1-flash-lite": "pro",
	"google/gemini-3.5-flash": "pro",
	"google/gemini-3.5-flash-lite": "pro",
	"google/gemini-3.6-flash": "pro",
	"gpt-5.3-codex": "pro",
	"gpt-5.4": "pro",
	"gpt-5.4-mini": "pro",
	"gpt-5.5": "pro",
	"gpt-5.6-terra": "pro",
	"meta/muse-spark-1.1": "pro",
	"claude-fable-5": "provider",
	"claude-opus-4-7": "provider",
	"claude-opus-4-8": "provider",
	"claude-opus-5": "provider",
	"sakana/fugu-ultra": "provider"
};
/** Official display labels for each plan tier. */
const PLAN_LABELS = {
	go: "Go",
	goat: "GOAT",
	pro: "Pro",
	provider: "Provider",
	max: "Max"
};
/**
* Plan-tier sort weights, low to high. Models outside the snapshot (unknown
* plans) sort after every known tier, keeping known models predictable.
*/
const PLAN_ORDER = {
	go: 0,
	goat: 1,
	pro: 2,
	provider: 3,
	max: 4
};
/**
* Comparator for the model picker: sort by plan tier (lowest first), then by
* model name, then by id as a tiebreak. Models with no known plan sort last.
*/
function compareByPlan(a, b) {
	const pa = PLAN_ORDER[KNOWN_PLANS[a.id] ?? ""] ?? Number.MAX_SAFE_INTEGER;
	const pb = PLAN_ORDER[KNOWN_PLANS[b.id] ?? ""] ?? Number.MAX_SAFE_INTEGER;
	if (pa !== pb) return pa - pb;
	const nameDiff = a.name.localeCompare(b.name);
	if (nameDiff !== 0) return nameDiff;
	return a.id.localeCompare(b.id);
}
/**
* Subscription plan table, synced from the official CLI bundle's plan maps
* (`Nn`/`$n` in command-code@1.31.0 `dist/cli.mjs`): subscription `planId`
* prefix → display name and the plan's monthly credit total. This is the
* account's own subscription (from `/alpha/billing/subscriptions`) — distinct
* from {@link KNOWN_PLANS}, which maps catalog models to their minimum tier.
*
* `tierWeight` is plugin-added (not from the CLI maps): the plan's rank on
* the {@link PLAN_ORDER} scale, used by the picker's plan filter
* ({@link modelVisibleInPlan}) to hide models above the account's tier.
*/
const KNOWN_SUBSCRIPTION_PLANS = {
	"individual-go": {
		name: "Go",
		monthlyCredits: 10,
		tierWeight: 0
	},
	"individual-goat": {
		name: "GOAT",
		monthlyCredits: 70,
		tierWeight: 1
	},
	"individual-pro": {
		name: "Pro",
		monthlyCredits: 30,
		tierWeight: 2
	},
	"individual-pro-v1": {
		name: "Pro",
		monthlyCredits: 80,
		tierWeight: 2
	},
	"individual-provider": {
		name: "Provider",
		monthlyCredits: 15,
		tierWeight: 3
	},
	"individual-max": {
		name: "Max",
		monthlyCredits: 150,
		tierWeight: 4
	},
	"individual-ultra": {
		name: "Ultra",
		monthlyCredits: 300,
		tierWeight: 4
	},
	"teams-pro": {
		name: "Teams Pro",
		monthlyCredits: 40,
		tierWeight: 2
	}
};
/** Plan-id prefixes, longest first — the CLI's prefix-match order. */
const SUBSCRIPTION_PLAN_PREFIXES = Object.keys(KNOWN_SUBSCRIPTION_PLANS).sort((a, b) => b.length - a.length);
/**
* Resolve a subscription `planId` (e.g. `individual-pro-v1`) to its display
* name and monthly credit total, mirroring the CLI's `getPlanInfo`:
* normalize (lowercase, `_` → `-`), then longest-prefix match so
* `individual-pro-v1` wins over `individual-pro`. Unknown ids return
* `undefined`.
*/
function subscriptionPlanInfo(planId) {
	const normalized = planId.toLowerCase().replace(/_/g, "-");
	const prefix = SUBSCRIPTION_PLAN_PREFIXES.find((candidate) => normalized.startsWith(candidate));
	return prefix === void 0 ? void 0 : KNOWN_SUBSCRIPTION_PLANS[prefix];
}
/**
* Whether the picker lists `modelId` for an account with the given billing
* access. Fails open at every uncertainty: no billing data, an unknown plan,
* or a model outside {@link KNOWN_PLANS} all keep the model visible — the
* server remains the final gate (`403 MODEL_NOT_IN_PLAN`).
*/
function modelVisibleInPlan(modelId, access) {
	if (access === void 0) return true;
	if (access.onDemandCredits > 0) return true;
	if (access.tierWeight === void 0) return true;
	const tier = KNOWN_PLANS[modelId];
	if (tier === void 0) return true;
	const weight = PLAN_ORDER[tier];
	if (weight === void 0) return true;
	return weight <= access.tierWeight;
}
const KNOWN_DEALS = {
	"google/gemini-3.7-flash": {
		label: "50% off",
		expiresAt: "2026-12-31T23:59:59Z"
	},
	"MiniMaxAI/MiniMax-M3": { label: "50% off" },
	"xiaomi/mimo-v2.5-pro": { label: "99% off" },
	"xiaomi/mimo-v2.5": { label: "98% off" },
	"poolside/laguna-s-2.1-free": {
		label: "FREE",
		free: true
	},
	"stealth/ox-alpha": {
		label: "FREE",
		free: true
	}
};
/**
* Models with time-of-day (peak/off-peak) pricing, per the official pricing
* page (`/docs/resources/pricing-limits`). Since 2026-08-16 16:00 UTC, DeepSeek
* charges by the hour: peak hours are 01:00–04:00 and 06:00–10:00 UTC (7h/day,
* full price); the other 17 hours are off-peak at half price. The picker shows
* the *current* state as a compact label (`Peak`/`Half`) matching the English
* noun style of the other markers (`Image`, `FREE`), so a developer can tell at
* a glance whether calling the model right now is cheap or expensive.
*
* Keep in sync with the official pricing page when the model set or the peak
* windows change (see the dsh-commandcode-upstream skill).
*/
const KNOWN_PEAK_PRICING = /* @__PURE__ */ new Set(["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"]);
/** Peak hours (UTC, hour-of-day range end-exclusive): 01–03 and 06–09. */
const PEAK_HOUR_RANGES = [[1, 4], [6, 10]];
/**
* Whether `now` (defaults to `Date.now()`) falls in a peak-pricing hour for
* time-of-day-priced models. `undefined` for models outside the snapshot.
*/
function peakPricingState(modelId, now = Date.now()) {
	if (!KNOWN_PEAK_PRICING.has(modelId)) return void 0;
	const hour = new Date(now).getUTCHours();
	return PEAK_HOUR_RANGES.some(([start, end]) => hour >= start && hour < end) ? "peak" : "off-peak";
}
/**
* Compact label for the current peak/off-peak state: `Peak` (full price) or
* `Half` (off-peak, half price). These English nouns match the picker's other
* markers (`Go`, `Image`, `FREE`), and since they appear only on time-of-day
* priced models they double as a "priced by the hour" signal. Returns undefined
* for models without time-of-day pricing.
*/
function peakPricingLabel(modelId, now = Date.now()) {
	const state = peakPricingState(modelId, now);
	if (state === void 0) return void 0;
	return state === "peak" ? "Peak" : "Half";
}
const COMMAND_CODE_CLI_VERSION = "1.31.0";
const DEFAULT_API_BASE = "https://api.commandcode.ai";
// Command Code's generate endpoint rejects values above 200,000.
const DEFAULT_GENERATE_MAX_TOKENS = 200000;
const DEFAULT_MAX_OUTPUT_TOKENS = 200000;
const MODELS_TIMEOUT_MS = 1e4;
/** How long the picker's plan-filter billing facts stay cached before refetching. */
const BILLING_ACCESS_TTL_MS = 3e5;
/**
* Subscription statuses the CLI treats as live (`Mr` in command-code's
* cli.mjs): the plan gate applies only under one of these.
*/
const ACTIVE_SUBSCRIPTION_STATUSES = /* @__PURE__ */ new Set([
	"active",
	"trialing",
	"past_due"
]);
/** Head-of-request timeout: how long to wait for the first response byte. */
const DEFAULT_REQUEST_TIMEOUT_MS = 6e4;
/** Stream idle timeout: a generation that stalls this long is a dead connection. */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
const MODEL_CACHE_VERSION = 1;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Official display label for a model's minimum plan, or undefined for models
* outside the snapshot (e.g. future catalog additions).
*/
function planLabel(modelId) {
	const plan = KNOWN_PLANS[modelId];
	return plan === void 0 ? void 0 : PLAN_LABELS[plan];
}
/**
* The active deal label for a model, or undefined when the model has no deal
* or the deal has expired. Expiry is judged against `now` (defaults to
* `Date.now()`), so a snapshot that has gone stale stops showing its discount
* the moment the official end date passes — the user never believes a lapsed
* deal is still live. Permanent deals (no `expiresAt`) never lapse.
*/
function dealLabel(modelId, now = Date.now()) {
	const deal = KNOWN_DEALS[modelId];
	if (deal === void 0) return void 0;
	if (deal.expiresAt !== void 0 && now >= Date.parse(deal.expiresAt)) return void 0;
	return deal.label;
}
/**
* Compact human-readable context window, e.g. `1_000_000 -> "1M"`,
* `256_000 -> "256K"`, `262_144 -> "256K"` (floor to the nearest K).
* Returns undefined for unknown/absent sizes.
*/
function formatContext(contextWindow) {
	if (contextWindow === void 0 || !Number.isFinite(contextWindow) || contextWindow <= 0) return;
	if (contextWindow >= 1e6) {
		const m = contextWindow / 1e6;
		const rounded = Math.round(m * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}M`;
	}
	return `${Math.floor(contextWindow / 1e3)}K`;
}
/**
* Compact one-line summary for the model picker: plan tier, then any active
* deal (discount or FREE), then the current peak/off-peak state (`Peak`/`Half`)
* for time-of-day-priced models, then `Image` for Vision-capable models, then
* the context window. Text-only models simply omit the Image marker — "Text
* only" adds nothing the picker needs to show.
*/
function capabilityDescription(modelId, contextWindow, now = Date.now()) {
	const parts = [];
	const plan = planLabel(modelId);
	if (plan !== void 0) parts.push(plan);
	const deal = dealLabel(modelId, now);
	if (deal !== void 0) parts.push(deal);
	const peak = peakPricingLabel(modelId, now);
	if (peak !== void 0) parts.push(peak);
	if (KNOWN_IMAGE_MODELS.has(modelId)) parts.push("Image");
	const ctx = formatContext(contextWindow);
	if (ctx !== void 0) parts.push(ctx);
	return parts.join(" · ");
}
function stringValue(value) {
	return typeof value === "string" ? value : void 0;
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function booleanValue(value) {
	return typeof value === "boolean" ? value : void 0;
}
/** Parse a billing-period timestamp (ISO string or millis) into millis; 0 when absent/invalid. */
function periodEndValue(value) {
	const asNumber = numberValue(value);
	if (asNumber !== void 0) return asNumber;
	const asString = stringValue(value);
	if (asString === void 0) return 0;
	const parsed = Date.parse(asString);
	return Number.isNaN(parsed) ? 0 : parsed;
}
/**
* Terminal stream-error markers from the official CLI (`Xw` in command-code's
* cli.mjs): these always mean "retrying cannot succeed", so the adapter must
* not classify them as transient server errors.
*/
const TERMINAL_STREAM_ERROR_MARKERS = [
	"premium_credits_exhausted",
	"model_not_in_plan",
	"insufficient credits"
];
function hasTerminalStreamMarker(message) {
	const lower = message.toLowerCase();
	return TERMINAL_STREAM_ERROR_MARKERS.some((marker) => lower.includes(marker));
}
function recordOrEmpty(value) {
	if (isRecord(value)) return value;
	if (typeof value === "string") try {
		const parsed = JSON.parse(value);
		if (isRecord(parsed)) return parsed;
	} catch {}
	return {};
}
function projectSlugFromPath(pathName) {
	return pathName.toLowerCase().replace(/^[a-z]:/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|(?<!-)-+$/g, "") || "project";
}
function parseStreamEventLine(line) {
	let trimmed = line.trim();
	if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return void 0;
	if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
	if (!trimmed || trimmed === "[DONE]") return void 0;
	try {
		return JSON.parse(trimmed);
	} catch {
		return;
	}
}
/** Extract the key from the CLI's nested credential records (`command-code`). */
function apiKeyFromCredentialRecord(value) {
	if (!isRecord(value)) return void 0;
	const type = stringValue(value.type);
	if (type === "api") return stringValue(value.key);
	if (type === "oauth") return stringValue(value.access);
	return stringValue(value.key) ?? stringValue(value.access);
}
/** Read a usable Command Code credential from the official CLI auth file. */
function resolveAuthFileApiKey() {
	const authPath = join(homedir(), ".commandcode", "auth.json");
	try {
		if (!existsSync(authPath)) return void 0;
		const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
		if (!isRecord(parsed)) return void 0;
		const direct = stringValue(parsed.apiKey) ?? stringValue(parsed.commandcode);
		if (direct) return direct;
		return apiKeyFromCredentialRecord(parsed.commandcode) ?? apiKeyFromCredentialRecord(parsed["command-code"]);
	} catch {}
}
function parseCatalogResponse(value) {
	if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) throw new LlmError("Unexpected Command Code models response shape", "PROVIDER_PROTOCOL_ERROR");
	const models = [];
	for (const entry of value.data) {
		if (!isRecord(entry)) continue;
		const id = stringValue(entry.id);
		const name = stringValue(entry.name);
		const contextLength = numberValue(entry.context_length);
		if (!id || !name || !contextLength || contextLength <= 0) continue;
		models.push({
			id,
			name,
			contextWindow: contextLength,
			maxTokens: Math.min(contextLength, DEFAULT_MAX_OUTPUT_TOKENS)
		});
	}
	if (models.length === 0) throw new LlmError("Command Code returned an empty model catalog", "PROVIDER_PROTOCOL_ERROR");
	return models;
}
async function readModelsCache(cachePath) {
	const parsed = JSON.parse(await readFile(cachePath, "utf-8"));
	if (!isRecord(parsed) || parsed.version !== MODEL_CACHE_VERSION || !Array.isArray(parsed.models)) throw new Error(`Invalid model cache at ${cachePath}`);
	return parsed.models;
}
async function writeModelsCache(cachePath, models) {
	await mkdir(dirname(cachePath), { recursive: true });
	const tmp = `${cachePath}.${process.pid}.tmp`;
	try {
		await writeFile(tmp, `${JSON.stringify({
			version: MODEL_CACHE_VERSION,
			models
		}, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 384
		});
		await rename(tmp, cachePath);
	} finally {
		await rm(tmp, { force: true }).catch(() => void 0);
	}
}
/**
* Collect the tool calls that have a paired tool result, plus each call's
* name. The name map feeds the `toolName` of replayed tool results: some
* backends (e.g. Google Gemini `functionResponse`) reject a result whose
* function name is empty, so the real name must round-trip (the official
* CLI does the same via its `tool_use_id -> toolName` map).
*/
function pairedToolCalls(messages) {
	const callIds = /* @__PURE__ */ new Set();
	const names = /* @__PURE__ */ new Map();
	const resultIds = /* @__PURE__ */ new Set();
	for (const message of messages) for (const block of message.content) {
		if (message.role === "assistant" && block.type === "tool-call") {
			callIds.add(block.id);
			names.set(block.id, block.name);
		}
		if (block.type === "tool-result") resultIds.add(block.toolCallId);
	}
	return {
		ids: new Set([...callIds].filter((id) => resultIds.has(id))),
		names
	};
}
function blockText(block) {
	return block.type === "text" || block.type === "reasoning" ? block.text : "";
}
function toolResultText(block) {
	return block.content.map(blockText).filter(Boolean).join("\n");
}
function hasImageContent(message) {
	const check = (blocks) => blocks.some((b) => b.type === "image" || b.type === "tool-result" && check(b.content));
	return check(message.content);
}
/**
* Convert one image reference to the Command Code wire format, as the official
* CLI does: `{ type: 'image', source: { type: 'base64', media_type, data } }`.
* Bytes come from the durable attachment service; the media type is the one
* verified at save time.
*/
async function imageToCommandCode(ref, readImage) {
	const data = await readImage(ref);
	return {
		type: "image",
		source: {
			type: "base64",
			media_type: ref.mediaType,
			data: Buffer.from(data).toString("base64")
		}
	};
}
async function messagesToCC(messages, readImage) {
	const out = [];
	const { ids: paired, names: toolNames } = pairedToolCalls(messages);
	for (const message of messages) {
		if (message.role === "system") continue;
		if (message.role === "user" && message.source.kind !== "tool") {
			const parts = [];
			for (const block of message.content) {
				if (block.type === "text") parts.push({
					type: "text",
					text: block.text
				});
				if (block.type === "image") {
					if (!readImage) throw new LlmError("Image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
					parts.push(await imageToCommandCode(block.attachment, readImage));
				}
			}
			out.push({
				role: "user",
				content: parts
			});
			continue;
		}
		if (message.role === "assistant") {
			const parts = [];
			for (const block of message.content) if (block.type === "text") parts.push({
				type: "text",
				text: block.text
			});
			else if (block.type === "tool-call" && paired.has(block.id)) parts.push({
				type: "tool-call",
				toolCallId: block.id,
				toolName: block.name,
				input: recordOrEmpty(block.arguments)
			});
			if (parts.length > 0) out.push({
				role: "assistant",
				content: parts
			});
			continue;
		}
		if (message.role === "user" && message.source.kind === "tool") {
			const block = message.content[0];
			if (!block || block.type !== "tool-result" || !paired.has(block.toolCallId)) continue;
			out.push({
				role: "tool",
				content: [{
					type: "tool-result",
					toolCallId: block.toolCallId,
					toolName: toolNames.get(block.toolCallId) || "unknown",
					output: block.isError ? {
						type: "error-text",
						value: toolResultText(block)
					} : {
						type: "text",
						value: toolResultText(block)
					}
				}]
			});
		}
	}
	return out;
}
var CommandCodeAdapter = class extends LlmAdapter {
	deps;
	catalog = [];
	fetchImpl;
	resolveAttachments;
	billingAccess = /* @__PURE__ */ new Map();
	billingAccessInflight = /* @__PURE__ */ new Map();
	constructor(deps) {
		super();
		this.deps = deps;
		this.fetchImpl = deps.fetchImpl ?? fetch;
		this.resolveAttachments = deps.resolveAttachments;
	}
	/**
	* Near-unbounded retry for transient failures only (`mode: 'normal'` with
	* an explicit 1000-attempt cap — opencode-style persistence without the
	* unbounded loop): `RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/
	* `EMPTY_RESPONSE` retry up to 1000 times with waits doubling from 500 ms
	* and capping at 15 minutes (±10% jitter), so an exhausted 5-hour window
	* recovers in-session instead of failing after two tries. Permanent
	* failures (an invalid key's `INVALID_CREDENTIAL`, `UNSUPPORTED_CONTENT`,
	* plan rejections) are absent from the whitelist and surface immediately
	* instead of looping. Waits the pool/adapter attach as
	* `providerRetryAfterMs` are honored verbatim at or below the 15-minute
	* cap and never attached above it (in normal mode a longer attached wait
	* makes the executor abandon the retry outright — see RETRY_MAX_DELAY_MS).
	*
	* Captured once at route registration (dsh-llm snapshots this value), so a
	* future config knob for it would apply on profile restart, not per request.
	*/
	providerRetryPolicy(_provider) {
		return resolveRetryPolicy({
			mode: "normal",
			maxRetries: 1e3,
			retryableCodes: [
				"EMPTY_RESPONSE",
				"RATE_LIMIT",
				"SERVER",
				"TIMEOUT",
				"TRANSPORT"
			],
			backoff: {
				initialDelayMs: 500,
				maxDelayMs: RETRY_MAX_DELAY_MS,
				jitterRatio: .1
			}
		}, "llm-commandcode: retryPolicy");
	}
	/** Refresh the catalog (live fetch, cache fallback) and return it. */
	async loadCatalog(signal) {
		const { apiBase, modelsCachePath } = this.deps.options();
		try {
			const response = await this.fetchImpl(`${apiBase}/provider/v1/models`, {
				headers: {
					accept: "application/json",
					...attributionHeaders()
				},
				signal: signal ?? AbortSignal.timeout(1e4)
			});
			if (!response.ok) throw new Error(`models endpoint returned ${response.status}`);
			this.catalog = parseCatalogResponse(await response.json());
			await writeModelsCache(modelsCachePath, this.catalog).catch(() => void 0);
		} catch (error) {
			if (signal?.aborted) throw error;
			this.catalog = await readModelsCache(modelsCachePath).catch(() => this.catalog);
		}
		return this.catalog;
	}
	async listModels(provider) {
		const catalog = await this.loadCatalog();
		const access = this.deps.options().filterModelsByPlan === false ? void 0 : await this.loadBillingAccess();
		return catalog.filter((model) => modelVisibleInPlan(model.id, access)).map((model) => {
			const vision = KNOWN_IMAGE_MODELS.has(model.id);
			return {
				provider,
				id: model.id,
				name: `${model.name} (CC)`,
				description: capabilityDescription(model.id, model.contextWindow),
				inputModalities: vision ? ["text", "image"] : ["text"]
			};
		}).sort(compareByPlan);
	}
	async resolveModel(provider, model, signal) {
		const entry = this.catalog.find((m) => m.id === model) ?? (await this.loadCatalog(signal)).find((m) => m.id === model);
		const efforts = await effortsForModel(model);
		const vision = KNOWN_IMAGE_MODELS.has(model);
		return {
			provider,
			id: model,
			name: entry ? `${entry.name} (CC)` : model,
			description: capabilityDescription(model, entry?.contextWindow),
			inputModalities: vision ? ["text", "image"] : ["text"],
			...entry ? {
				context: { contextWindow: entry.contextWindow },
				defaultMaxTokens: Math.min(entry.maxTokens, DEFAULT_GENERATE_MAX_TOKENS)
			} : {},
			...efforts ? { reasoning: { efforts: efforts.map((effort) => ({
				id: ReasoningEffortId(effort),
				name: effort
			})) } } : {}
		};
	}
	/** The headers every authenticated account endpoint shares. */
	async accountHeaders(apiKey) {
		const connection = this.deps.options();
		return {
			Authorization: `Bearer ${apiKey ?? await this.deps.resolveApiKey(connection)}`,
			"x-command-code-version": COMMAND_CODE_CLI_VERSION,
			"x-cli-environment": "production",
			...attributionHeaders()
		};
	}
	/**
	* The billing facts behind the picker's plan filter, cached for
	* {@link BILLING_ACCESS_TTL_MS} and shared across concurrent callers.
	* `undefined` means "unknown — show everything" (fail-open).
	*/
	async loadBillingAccess() {
		let apiKey;
		try {
			apiKey = await this.deps.resolveApiKey(this.deps.options());
		} catch {
			return;
		}
		const cached = this.billingAccess.get(apiKey);
		if (cached !== void 0 && Date.now() - cached.at < 3e5) return cached.value;
		const existing = this.billingAccessInflight.get(apiKey);
		if (existing !== void 0) return existing;
		const inflight = this.fetchBillingAccess(apiKey).then((value) => {
			this.billingAccess.set(apiKey, {
				value,
				at: Date.now()
			});
			return value;
		}).finally(() => {
			this.billingAccessInflight.delete(apiKey);
		});
		this.billingAccessInflight.set(apiKey, inflight);
		return inflight;
	}
	/**
	* The billing facts behind the picker's plan filter, mirroring the CLI's
	* `createBilling` flow: whoami yields the org id, then the subscriptions
	* and credits endpoints answer in parallel. The plan id is honored only
	* when the subscription reports an active-ish status (the CLI's rule); when
	* the subscriptions endpoint fails entirely, `credits.planId` is the
	* fallback (the CLI stamps plan identity from it too). Any failure resolves
	* to `undefined` (fail-open) rather than breaking the picker.
	*/
	async fetchBillingAccess(apiKey) {
		try {
			const connection = this.deps.options();
			const headers = await this.accountHeaders(apiKey);
			const base = connection.apiBase;
			const getJson = async (path) => {
				const response = await this.fetchImpl(`${base}${path}`, {
					headers,
					signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
				});
				if (!response.ok) return void 0;
				const parsed = await response.json();
				return isRecord(parsed) ? parsed : void 0;
			};
			const whoami = await getJson("/alpha/whoami");
			const orgData = whoami && isRecord(whoami.org) ? whoami.org : void 0;
			const orgId = orgData === void 0 ? void 0 : stringValue(orgData.id);
			const [subscription, credits] = await Promise.all([getJson(orgId === void 0 ? "/alpha/billing/subscriptions" : `/alpha/billing/subscriptions?orgId=${encodeURIComponent(orgId)}`), getJson("/alpha/billing/credits")]);
			const subData = subscription && isRecord(subscription.data) ? subscription.data : void 0;
			const creditsData = credits && isRecord(credits.credits) ? credits.credits : void 0;
			if (subData === void 0 && creditsData === void 0) return void 0;
			let planId;
			if (subData !== void 0) {
				const status = stringValue(subData.status);
				if (status !== void 0 && ACTIVE_SUBSCRIPTION_STATUSES.has(status)) planId = stringValue(subData.planId);
			} else planId = stringValue(creditsData?.planId);
			return {
				tierWeight: planId === void 0 ? void 0 : subscriptionPlanInfo(planId)?.tierWeight,
				onDemandCredits: (numberValue(creditsData?.purchasedCredits) ?? 0) + (numberValue(creditsData?.freeCredits) ?? 0)
			};
		} catch {
			return;
		}
	}
	/**
	* Fetch account, usage, credit, and subscription state from the Command
	* Code account endpoints (`/alpha/whoami`, `/alpha/usage/summary`,
	* `/alpha/billing/credits`, `/alpha/billing/subscriptions`).
	* Each endpoint degrades independently: a failed one lands in `failures`
	* while the rest still report, so a transient outage never blanks the whole
	* view. Requires a usable API key (throws `MISSING_CREDENTIAL` otherwise).
	* Pass `apiKey` to report on a specific account of a multi-account pool;
	* the default resolves the currently active account.
	*/
	async getUsage(apiKey) {
		const base = this.deps.options().apiBase;
		const headers = await this.accountHeaders(apiKey);
		const failures = [];
		const getJson = async (path) => {
			try {
				const response = await this.fetchImpl(`${base}${path}`, {
					headers,
					signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
				});
				if (!response.ok) {
					failures.push(`${path}: HTTP ${response.status}`);
					return;
				}
				const parsed = await response.json();
				return isRecord(parsed) ? parsed : void 0;
			} catch (error) {
				failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
		};
		const report = { failures };
		const whoami = await getJson("/alpha/whoami");
		const whoamiData = whoami && isRecord(whoami.user) ? whoami.user : void 0;
		if (whoamiData) report.account = {
			id: stringValue(whoamiData.id) ?? "",
			name: stringValue(whoamiData.name) ?? "",
			userName: stringValue(whoamiData.userName) ?? ""
		};
		const orgData = whoami && isRecord(whoami.org) ? whoami.org : void 0;
		const orgId = orgData === void 0 ? void 0 : stringValue(orgData.id);
		const usage = await getJson("/alpha/usage/summary");
		if (usage) report.usage = {
			totalCount: numberValue(usage.totalCount) ?? 0,
			totalCost: numberValue(usage.totalCost) ?? 0,
			successRate: numberValue(usage.successRate) ?? 0,
			completedCount: numberValue(usage.completedCount) ?? 0,
			failedCount: numberValue(usage.failedCount) ?? 0,
			totalTokensIn: numberValue(usage.totalTokensIn) ?? 0,
			totalTokensOut: numberValue(usage.totalTokensOut) ?? 0,
			totalCredits: numberValue(usage.totalCredits) ?? 0,
			periodBasis: stringValue(usage.periodBasis) ?? "billing-period"
		};
		const credits = await getJson("/alpha/billing/credits");
		const creditsData = credits && isRecord(credits.credits) ? credits.credits : void 0;
		const windowLimits = credits && isRecord(credits.windowLimits) ? credits.windowLimits : void 0;
		const fiveHour = windowLimits && isRecord(windowLimits.fiveHour) ? windowLimits.fiveHour : void 0;
		const weekly = windowLimits && isRecord(windowLimits.weekly) ? windowLimits.weekly : void 0;
		if (creditsData || fiveHour || weekly) report.credits = {
			monthlyCredits: numberValue(creditsData?.monthlyCredits) ?? 0,
			purchasedCredits: numberValue(creditsData?.purchasedCredits) ?? 0,
			freeCredits: numberValue(creditsData?.freeCredits) ?? 0,
			fiveHour: {
				used: numberValue(fiveHour?.used) ?? 0,
				cap: numberValue(fiveHour?.cap) ?? 0,
				exceeded: fiveHour?.exceeded === true,
				resetAt: numberValue(fiveHour?.resetAt) ?? 0
			},
			weekly: {
				used: numberValue(weekly?.used) ?? 0,
				cap: numberValue(weekly?.cap) ?? 0,
				exceeded: weekly?.exceeded === true,
				resetAt: numberValue(weekly?.resetAt) ?? 0
			}
		};
		const subscription = await getJson(orgId === void 0 ? "/alpha/billing/subscriptions" : `/alpha/billing/subscriptions?orgId=${encodeURIComponent(orgId)}`);
		const subData = subscription && isRecord(subscription.data) ? subscription.data : void 0;
		const planId = stringValue(subData?.planId) ?? stringValue(creditsData?.planId);
		if (subData !== void 0 || planId !== void 0) {
			const info = planId === void 0 ? void 0 : subscriptionPlanInfo(planId);
			report.plan = {
				planId: planId ?? "",
				name: info?.name ?? planId ?? "",
				status: stringValue(subData?.status) ?? "",
				monthlyCredits: info?.monthlyCredits ?? null,
				currentPeriodEnd: periodEndValue(subData?.currentPeriodEnd)
			};
		}
		return report;
	}
	/**
	* Probe one account's five-hour window from `/alpha/billing/credits`. The
	* multi-account pool calls this when every account is marked exhausted: an
	* account whose window no longer reports `exceeded` is revived, and the
	* `resetAt` values feed the "earliest reset" error message. Returns
	* `undefined` when the probe itself failed (transport, non-200, or a
	* payload without window limits) — a failed probe never changes pool state.
	*/
	async probeFiveHourWindow(apiKey) {
		try {
			const connection = this.deps.options();
			const response = await this.fetchImpl(`${connection.apiBase}/alpha/billing/credits`, {
				headers: await this.accountHeaders(apiKey),
				signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
			});
			if (!response.ok) return void 0;
			const parsed = await response.json();
			if (!isRecord(parsed)) return void 0;
			const windowLimits = isRecord(parsed.windowLimits) ? parsed.windowLimits : void 0;
			const fiveHour = windowLimits && isRecord(windowLimits.fiveHour) ? windowLimits.fiveHour : void 0;
			if (fiveHour === void 0) return void 0;
			return {
				exceeded: fiveHour.exceeded === true,
				resetAt: numberValue(fiveHour.resetAt) ?? 0
			};
		} catch {
			return;
		}
	}
	async *stream(options) {
		if (options.stop?.length) throw new LlmError("Command Code adapter does not support stop sequences", "UNSUPPORTED_OPTION");
		const hasImages = options.messages.some(hasImageContent);
		let readImage;
		if (hasImages) {
			if (!KNOWN_IMAGE_MODELS.has(options.model)) throw new LlmError(`Command Code model "${options.model}" does not support image input; switch to a Vision-capable model (see the model registry)`, "UNSUPPORTED_CONTENT");
			const attachments = this.resolveAttachments?.();
			if (attachments === void 0) throw new LlmError("Command Code image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
			readImage = (ref) => attachments.readImage(ref).then((stored) => stored.data);
		}
		const connection = this.deps.options();
		let apiKey = await this.deps.resolveApiKey(connection);
		const modelMax = this.catalog.find((m) => m.id === options.model)?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
		const maxTokens = Math.min(options.maxTokens ?? modelMax, modelMax, DEFAULT_GENERATE_MAX_TOKENS);
		const effort = options.reasoningEffort;
		const supported = await effortsForModel(options.model);
		const reasoningEffort = effort && effort !== "off" && supported?.includes(effort) ? effort : void 0;
		const systemText = [options.system ?? "", ...options.messages.filter((m) => m.role === "system").map((m) => m.content.map(blockText).filter(Boolean).join("\n"))].filter(Boolean).join("\n\n");
		const body = {
			config: {
				workingDir: connection.workingDir,
				date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
				environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
				structure: [],
				isGitRepo: false,
				currentBranch: "",
				mainBranch: "",
				gitStatus: "",
				recentCommits: []
			},
			memory: null,
			taste: null,
			skills: null,
			params: {
				model: options.model,
				messages: await messagesToCC(options.messages, readImage),
				tools: (options.tools ?? []).map((tool) => ({
					type: "function",
					name: tool.name,
					description: tool.description,
					input_schema: tool.parameters
				})),
				system: systemText,
				max_tokens: maxTokens,
				temperature: options.temperature ?? .3,
				stream: true,
				...reasoningEffort ? { reasoning_effort: reasoningEffort } : {}
			},
			threadId: randomUUID()
		};
		const connect = async (key) => {
			const connectAbort = new AbortController();
			let connectTimedOut = false;
			const connectTimer = setTimeout(() => {
				connectTimedOut = true;
				connectAbort.abort(new DOMException(`Command Code API request to ${connection.apiBase}/alpha/generate did not respond within ${connection.requestTimeoutMs}ms`, "TimeoutError"));
			}, connection.requestTimeoutMs);
			const onCallerAbort = () => {
				connectAbort.abort(options.signal?.reason);
			};
			if (options.signal) {
				if (options.signal.aborted) onCallerAbort();
				else options.signal.addEventListener("abort", onCallerAbort, { once: true });
			}
			const cleanup = () => {
				clearTimeout(connectTimer);
				if (options.signal) options.signal.removeEventListener("abort", onCallerAbort);
			};
			let response;
			try {
				response = await this.fetchImpl(`${connection.apiBase}/alpha/generate`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${key}`,
						"x-command-code-version": COMMAND_CODE_CLI_VERSION,
						"x-cli-environment": "production",
						"x-project-slug": projectSlugFromPath(connection.workingDir),
						"x-taste-learning": "true",
						"x-co-flag": "false",
						...attributionHeaders()
					},
					body: JSON.stringify(body),
					signal: connectAbort.signal
				});
				clearTimeout(connectTimer);
			} catch (error) {
				cleanup();
				if (options.signal?.aborted) throw error;
				if (connectTimedOut || error instanceof DOMException && error.name === "TimeoutError") throw new LlmError(`Command Code API request to ${connection.apiBase}/alpha/generate did not respond within ${connection.requestTimeoutMs}ms: ${errorChain(error)}`, "TIMEOUT", { cause: error });
				throw new LlmError(`Command Code API request to ${connection.apiBase}/alpha/generate failed: ${errorChain(error)}`, "TRANSPORT", { cause: error });
			}
			if (!response.ok) {
				const errText = await response.text().catch(() => "");
				cleanup();
				const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
				return retryAfterMs === void 0 ? {
					status: response.status,
					errText
				} : {
					status: response.status,
					errText,
					retryAfterMs
				};
			}
			return {
				response,
				cleanup
			};
		};
		const tried = /* @__PURE__ */ new Set();
		let connected;
		for (;;) {
			tried.add(apiKey);
			const attempt = await connect(apiKey);
			if ("response" in attempt) {
				connected = attempt;
				break;
			}
			const rotate = this.deps.rotateApiKey;
			if ((attempt.status === 429 || attempt.status === 401) && rotate !== void 0 && options.signal?.aborted !== true && tried.size < MAX_ACCOUNT_ROTATIONS) {
				const next = await rotate(apiKey, attempt.status === 429 ? "rate-limit" : "invalid-credential", connection);
				if (next !== void 0 && !tried.has(next)) {
					apiKey = next;
					continue;
				}
			}
			throw generateHttpError(attempt.status, attempt.errText, attempt.retryAfterMs);
		}
		const { response, cleanup } = connected;
		if (!response.body) {
			cleanup();
			throw new LlmError("Command Code API returned no response body", "PROVIDER_PROTOCOL_ERROR");
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let idleTimer;
		let idleFired = false;
		const armIdle = () => {
			if (idleTimer !== void 0) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				idleFired = true;
				reader.cancel().catch(() => void 0);
			}, connection.streamIdleTimeoutMs);
		};
		const clearIdle = () => {
			if (idleTimer !== void 0) {
				clearTimeout(idleTimer);
				idleTimer = void 0;
			}
		};
		let nextIndex = 0;
		let textIndex = -1;
		let textContent = "";
		let reasoningIndex = -1;
		let reasoningContent = "";
		let sawContent = false;
		const closeText = function* () {
			if (textIndex < 0) return;
			yield {
				type: "block-end",
				index: textIndex,
				block: {
					type: "text",
					text: textContent
				}
			};
			textIndex = -1;
			textContent = "";
		};
		const closeReasoning = function* () {
			if (reasoningIndex < 0) return;
			yield {
				type: "block-end",
				index: reasoningIndex,
				block: {
					type: "reasoning",
					text: reasoningContent
				}
			};
			reasoningIndex = -1;
			reasoningContent = "";
		};
		const handleEvent = (event) => {
			const chunks = [];
			if (!isRecord(event)) return chunks;
			switch (event.type) {
				case "text-delta": {
					chunks.push(...closeReasoning());
					if (textIndex < 0) {
						textIndex = nextIndex++;
						chunks.push({
							type: "block-start",
							index: textIndex,
							blockType: "text"
						});
					}
					const delta = stringValue(event.text) ?? "";
					textContent += delta;
					sawContent = true;
					chunks.push({
						type: "text-delta",
						index: textIndex,
						text: delta
					});
					break;
				}
				case "reasoning-delta": {
					chunks.push(...closeText());
					if (reasoningIndex < 0) {
						reasoningIndex = nextIndex++;
						chunks.push({
							type: "block-start",
							index: reasoningIndex,
							blockType: "reasoning"
						});
					}
					const delta = stringValue(event.text) ?? "";
					reasoningContent += delta;
					chunks.push({
						type: "reasoning-delta",
						index: reasoningIndex,
						text: delta
					});
					break;
				}
				case "reasoning-start":
					chunks.push(...closeText());
					break;
				case "reasoning-end":
					chunks.push(...closeReasoning());
					break;
				case "tool-call": {
					chunks.push(...closeText(), ...closeReasoning());
					const id = stringValue(event.toolCallId) ?? randomUUID();
					const name = stringValue(event.toolName) ?? "";
					const args = JSON.stringify(recordOrEmpty(event.input ?? event.args ?? event.arguments));
					const index = nextIndex++;
					sawContent = true;
					chunks.push({
						type: "block-start",
						index,
						blockType: "tool-call"
					}, {
						type: "tool-call-delta",
						index,
						id: CallId(id),
						name,
						argumentsDelta: args
					}, {
						type: "block-end",
						index,
						block: {
							type: "tool-call",
							id: CallId(id),
							name,
							arguments: args
						}
					});
					break;
				}
				case "finish": {
					chunks.push(...closeText(), ...closeReasoning());
					const usage = isRecord(event.totalUsage) ? event.totalUsage : void 0;
					if (usage) {
						const details = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : void 0;
						const totalInput = numberValue(usage.inputTokens) ?? 0;
						const cacheRead = numberValue(details?.cacheReadTokens) ?? 0;
						const cacheWrite = numberValue(details?.cacheWriteTokens) ?? 0;
						const tokenUsage = {
							inputTokens: numberValue(details?.noCacheTokens) ?? Math.max(0, totalInput - cacheRead - cacheWrite),
							outputTokens: numberValue(usage.outputTokens) ?? 0,
							cacheReadTokens: cacheRead,
							cacheWriteTokens: cacheWrite
						};
						chunks.push({
							type: "usage",
							usage: tokenUsage
						});
					}
					chunks.push({
						type: "finish",
						reason: mapFinishReason(event.finishReason)
					});
					break;
				}
				case "error": {
					const err = isRecord(event.error) ? event.error : void 0;
					const detail = isRecord(event.error) ? stringValue(event.error.message) ?? JSON.stringify(event.error) : stringValue(event.error) ?? stringValue(event.message) ?? "Stream error";
					const statusCode = err ? numberValue(err.statusCode) : void 0;
					const isRetryable = err ? booleanValue(err.isRetryable) : void 0;
					const retryableStatus = statusCode !== void 0 && (statusCode === 429 || statusCode >= 500);
					const terminal = hasTerminalStreamMarker(detail);
					if (!(isRetryable === true || (statusCode !== void 0 ? retryableStatus : isRetryable !== false && !terminal))) throw new LlmError(`Command Code stream error: ${detail}`, "PROVIDER_STREAM_ERROR", statusCode !== void 0 ? { status: statusCode } : void 0);
					throw new LlmError(`Command Code stream error: ${detail}`, "SERVER", statusCode !== void 0 ? { status: statusCode } : void 0);
				}
			}
			return chunks;
		};
		try {
			let finished = false;
			for (;;) {
				let read;
				armIdle();
				try {
					read = await reader.read();
				} catch (error) {
					if (options.signal?.aborted) throw error;
					throw new LlmError(`Command Code API stream from ${connection.apiBase} failed while reading: ${errorChain(error)}`, "TRANSPORT", { cause: error });
				} finally {
					clearIdle();
				}
				const { done, value } = read;
				if (done) {
					if (idleFired) throw new LlmError(`Command Code API stream from ${connection.apiBase} was idle for ${connection.streamIdleTimeoutMs}ms (no events) and was treated as a dead connection`, "TIMEOUT");
					if (buffer.trim()) for (const chunk of handleEvent(parseStreamEventLine(buffer))) yield chunk;
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const chunks = handleEvent(parseStreamEventLine(line));
					for (const chunk of chunks) {
						yield chunk;
						if (chunk.type === "finish") finished = true;
					}
				}
				if (finished) break;
			}
			if (!finished) {
				yield* closeText();
				yield* closeReasoning();
				if (!sawContent) throw new LlmError("Command Code returned an empty response", "EMPTY_RESPONSE");
				yield {
					type: "finish",
					reason: { kind: "stop" }
				};
			}
		} finally {
			clearIdle();
			cleanup();
			await reader.cancel().catch(() => void 0);
			reader.releaseLock();
		}
	}
};
/** Hard cap on account rotations within one request (one attempt per distinct key). */
const MAX_ACCOUNT_ROTATIONS = 16;
/**
* Map a pre-stream generate HTTP failure onto a stable LlmError. Command
* Code folds several business rejections into 403 (plan limits, CLI version,
* model access): prefer the machine-readable `error.code` when present; the
* status alone cannot distinguish them. A 429's `Retry-After` rides along as
* `providerRetryAfterMs` so dsh-llm-retry can wait exactly that long instead
* of guessing at the backoff cadence — capped at RETRY_MAX_DELAY_MS, because
* in normal mode a longer attached wait makes the executor abandon the retry
* outright instead of falling back to local backoff.
*/
function generateHttpError(status, errText, retryAfterMs) {
	let providerCode;
	try {
		const parsed = JSON.parse(errText);
		if (isRecord(parsed) && isRecord(parsed.error)) providerCode = stringValue(parsed.error.code);
	} catch {}
	const detail = providerCode ?? `HTTP ${status}`;
	if (status === 401) return new LlmError(`Command Code API error 401 (${detail}): the API key is missing or invalid — check the key stored for COMMANDCODE_API_KEY (Models page) or the auth file`, "INVALID_CREDENTIAL", { status: 401 });
	return new LlmError(`Command Code API error ${status}${detail === `HTTP ${status}` ? "" : ` (${detail})`}: ${errText.slice(0, 500)}`, status === 429 ? "RATE_LIMIT" : "PROVIDER_HTTP_ERROR", {
		status,
		...retryAfterMs !== void 0 && retryAfterMs > 0 && retryAfterMs <= 9e5 ? { providerRetryAfterMs: retryAfterMs } : {}
	});
}
/**
* Parse an HTTP `Retry-After` value (delay-seconds or an HTTP-date) into
* milliseconds; undefined when absent or unparseable. An HTTP-date in the
* past yields 0, which the caller drops (LlmError wants a positive delay).
* A delay-seconds value whose millisecond product is not finite (e.g. `1e308`)
* also yields undefined: LlmError validates its options and would otherwise
* replace the provider failure with an internal construction error.
*/
function parseRetryAfterMs(value, now = Date.now()) {
	if (value === void 0 || value === null) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds >= 0) {
		const ms = seconds * 1e3;
		return Number.isFinite(ms) ? Math.round(ms) : void 0;
	}
	const date = Date.parse(trimmed);
	if (!Number.isNaN(date)) return Math.max(0, date - now);
}
function mapFinishReason(reason) {
	if (reason === "tool-calls") return { kind: "tool-calls" };
	if (reason === "length" || reason === "max_tokens" || reason === "max-tokens" || reason === "max_output_tokens") return { kind: "max-tokens" };
	return { kind: "stop" };
}
//#endregion
//#region src/commands.ts
/** Format a dollar amount. */
function money(value) {
	return `$${value.toFixed(4)}`;
}
/** Format a dollar amount compactly (2 decimals). */
function moneyShort(value) {
	return `$${value.toFixed(2)}`;
}
/** Format a token count with thousands separators. */
/** Format a large token count compactly (1.9亿 style). */
function tokensCompact(value) {
	if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
	return String(value);
}
/** Format a millis timestamp as a local date. */
function resetLabel(ms) {
	if (ms <= 0) return "n/a";
	return new Date(ms).toLocaleString();
}
/**
* A 10-cell horizontal bar: `██████████` for 100%, `███░░░░░░░` for ~33%.
* Handles caps of 0 (no limit) and out-of-range values.
*/
function bar(used, cap) {
	if (cap <= 0) return "—";
	const ratio = Math.max(0, Math.min(1, used / cap));
	const filled = Math.round(ratio * 10);
	return "█".repeat(filled) + "░".repeat(10 - filled);
}
/** Render one account's rotation mark / cooldown as a short badge. */
function markLabel(entry) {
	if (entry.mark === "invalid-credential") return "  ⛔ 密钥无效";
	if (entry.cooldownUntil > 0) return `  ⏳ 限额冷却中，重置 ${resetLabel(entry.cooldownUntil)}`;
	if (entry.mark === "rate-limit") return "  ⏳ 已达限额（等待窗口探测）";
	return "";
}
/** Render the usage report as a structured, aligned, bar-chart text view. */
function renderReport(report, title) {
	const lines = [];
	const account = report.account ? ` (${report.account.userName || report.account.name})` : "";
	lines.push(title ?? `📊 Command Code 用量${account}`, "");
	if (report.plan && report.plan.name !== "") {
		const p = report.plan;
		const status = p.status !== "" && p.status !== "active" ? ` (${p.status})` : "";
		const period = p.currentPeriodEnd > 0 ? ` · 账期截止 ${new Date(p.currentPeriodEnd).toLocaleDateString()}` : "";
		lines.push(`  📦 套餐    ${p.name}${status}${period}`, "");
	}
	if (report.usage) {
		const u = report.usage;
		lines.push("── 请求 ──────────────────────────────", `  💬 请求    ${u.completedCount} 次 / 失败 ${u.failedCount}  成功率 ${u.successRate}%`, `  💰 花费    ${money(u.totalCost)}  (${moneyShort(u.totalCredits)} credits)`, `  🔤 Token   ${tokensCompact(u.totalTokensIn)} 入 / ${tokensCompact(u.totalTokensOut)} 出`, "");
	}
	if (report.credits) {
		const c = report.credits;
		const monthlyPct = c.monthlyCredits > 0 ? `${(c.monthlyCredits / (c.monthlyCredits + c.purchasedCredits) * 100).toFixed(0)}%` : "—";
		lines.push("── 信用 ──────────────────────────────", `  💳 月额度  ${moneyShort(c.monthlyCredits)}   (已购 ${moneyShort(c.purchasedCredits)} / 赠送 ${moneyShort(c.freeCredits)})`, `     └ ${bar(c.monthlyCredits, c.monthlyCredits + c.purchasedCredits)}  ${monthlyPct}`, "", "── 窗口用量 ──────────────────────────", `  ⏱ 5 小时  ${moneyShort(c.fiveHour.used)} / ${moneyShort(c.fiveHour.cap)}${c.fiveHour.exceeded ? "  ⚠️ 超限!" : ""}`, `     └ ${bar(c.fiveHour.used, c.fiveHour.cap)}  重置 ${resetLabel(c.fiveHour.resetAt)}`, `  📅 每周    ${moneyShort(c.weekly.used)} / ${moneyShort(c.weekly.cap)}${c.weekly.exceeded ? "  ⚠️ 超限!" : ""}`, `     └ ${bar(c.weekly.used, c.weekly.cap)}  重置 ${resetLabel(c.weekly.resetAt)}`, "");
	}
	if (report.failures.length > 0) lines.push(`⚠️  部分端点失败: ${report.failures.join("; ")}`, "");
	if (!report.account && !report.usage && !report.credits) lines.push("(no data — check your API key)", "");
	return lines.join("\n").trimEnd();
}
/** The one registered `/commandcode` command. */
function commandDefinition(deps) {
	const { adapter } = deps;
	return {
		name: "commandcode",
		description: "Command Code account usage dashboard",
		input: { hint: "[status]" },
		handler: async () => {
			try {
				if (deps.reports !== void 0) {
					const { accounts } = await deps.reports();
					return {
						kind: "success",
						text: accounts.map((entry) => {
							const badges = `${entry.active ? "  ✅ 当前使用" : ""}${markLabel(entry)}`;
							const title = `📊 ${entry.label}${badges}`;
							if (!entry.configured) return `${title}\n\n  (未配置 API 密钥)`;
							return renderReport(entry.report, title);
						}).join("\n\n────────────────────\n\n")
					};
				}
				return {
					kind: "success",
					text: renderReport(await adapter.getUsage())
				};
			} catch (error) {
				return {
					kind: "error",
					text: `Could not fetch Command Code usage: ${error instanceof Error ? error.message : String(error)}`
				};
			}
		}
	};
}
/** Register the command on `ctx.commands` (called from the plugin entry). */
function applyCommands(ctx, deps) {
	ctx.commands.register(commandDefinition(deps));
}
//#endregion
//#region src/usage-wire.ts
/** The npm package identity both contribution registrations claim. */
const USAGE_REMOTE_PACKAGE = "dsh-commandcode-provider";
/** Canonical `<namespace>/<method>` endpoint of the usage report Remote. */
const USAGE_REPORT_ENDPOINT = "commandcode/report";
/** Reject one boundary value with a field-naming error. */
function reject(field) {
	throw new TypeError(`commandcode/report result: invalid ${field}`);
}
/** Read one required finite number field (`field` is the dotted error label). */
function numberField(source, key, field) {
	const value = source[key];
	if (typeof value !== "number" || !Number.isFinite(value)) reject(field);
	return value;
}
/** Read one required string field (`field` is the dotted error label). */
function stringField(source, key, field) {
	const value = source[key];
	if (typeof value !== "string") reject(field);
	return value;
}
/** Read one required boolean field (`field` is the dotted error label). */
function booleanField(source, key, field) {
	const value = source[key];
	if (typeof value !== "boolean") reject(field);
	return value;
}
/** Narrow an unknown value to a plain record, or reject. */
function record(value, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) reject(field);
	return value;
}
/** Validate one window-limit block (`fiveHour` / `weekly`). */
function windowLimit(value, field) {
	const source = record(value, field);
	return {
		used: numberField(source, "used", `${field}.used`),
		cap: numberField(source, "cap", `${field}.cap`),
		exceeded: booleanField(source, "exceeded", `${field}.exceeded`),
		resetAt: numberField(source, "resetAt", `${field}.resetAt`)
	};
}
/**
* Parse one untrusted boundary value into a {@link CommandCodeUsageReport}.
* Optional sections stay optional; every present field is shape-checked so a
* malformed frame fails the boundary instead of rendering garbage.
*/
function parseUsageReport(value) {
	const source = record(value, "report");
	const failures = source.failures;
	if (!Array.isArray(failures) || failures.some((entry) => typeof entry !== "string")) reject("failures");
	const report = { failures };
	if (source.account !== void 0) {
		const account = record(source.account, "account");
		report.account = {
			id: stringField(account, "id", "account.id"),
			name: stringField(account, "name", "account.name"),
			userName: stringField(account, "userName", "account.userName")
		};
	}
	if (source.usage !== void 0) {
		const usage = record(source.usage, "usage");
		report.usage = {
			totalCount: numberField(usage, "totalCount", "usage.totalCount"),
			totalCost: numberField(usage, "totalCost", "usage.totalCost"),
			successRate: numberField(usage, "successRate", "usage.successRate"),
			completedCount: numberField(usage, "completedCount", "usage.completedCount"),
			failedCount: numberField(usage, "failedCount", "usage.failedCount"),
			totalTokensIn: numberField(usage, "totalTokensIn", "usage.totalTokensIn"),
			totalTokensOut: numberField(usage, "totalTokensOut", "usage.totalTokensOut"),
			totalCredits: numberField(usage, "totalCredits", "usage.totalCredits"),
			periodBasis: stringField(usage, "periodBasis", "usage.periodBasis")
		};
	}
	if (source.credits !== void 0) {
		const credits = record(source.credits, "credits");
		report.credits = {
			monthlyCredits: numberField(credits, "monthlyCredits", "credits.monthlyCredits"),
			purchasedCredits: numberField(credits, "purchasedCredits", "credits.purchasedCredits"),
			freeCredits: numberField(credits, "freeCredits", "credits.freeCredits"),
			fiveHour: windowLimit(credits.fiveHour, "credits.fiveHour"),
			weekly: windowLimit(credits.weekly, "credits.weekly")
		};
	}
	if (source.plan !== void 0) {
		const plan = record(source.plan, "plan");
		const monthly = plan.monthlyCredits;
		if (monthly !== null && (typeof monthly !== "number" || !Number.isFinite(monthly))) reject("plan.monthlyCredits");
		report.plan = {
			planId: stringField(plan, "planId", "plan.planId"),
			name: stringField(plan, "name", "plan.name"),
			status: stringField(plan, "status", "plan.status"),
			monthlyCredits: monthly,
			currentPeriodEnd: numberField(plan, "currentPeriodEnd", "plan.currentPeriodEnd")
		};
	}
	return report;
}
/** Parse one untrusted boundary value into a {@link CommandCodeAccountUsage}. */
function parseAccountUsage(value) {
	const source = record(value, "account");
	return {
		id: stringField(source, "id", "account.id"),
		label: stringField(source, "label", "account.label"),
		configured: booleanField(source, "configured", "account.configured"),
		active: booleanField(source, "active", "account.active"),
		mark: stringField(source, "mark", "account.mark"),
		cooldownUntil: numberField(source, "cooldownUntil", "account.cooldownUntil"),
		report: parseUsageReport(source.report)
	};
}
/** Parse the wire result into a {@link CommandCodeAccountsReport}. */
function parseAccountsReport(value) {
	const accounts = record(value, "result").accounts;
	if (!Array.isArray(accounts)) reject("accounts");
	return { accounts: accounts.map(parseAccountUsage) };
}
/**
* The strict result codec both halves attach to the descriptor. Hand-rolled:
* the client bundle may not require a schema library, and `TypertSchema` is
* deliberately minimal so one `parse` function satisfies it.
*/
const usageReportSchema = { parse: parseAccountsReport };
/** The Host-face contribution registered on `ctx.typert`. */
const USAGE_HOST_CONTRIBUTION = {
	package: USAGE_REMOTE_PACKAGE,
	face: "host",
	schemas: [],
	invocations: [{
		id: `${USAGE_REMOTE_PACKAGE}#${USAGE_REPORT_ENDPOINT}`,
		service: "commandcodeUsage",
		namespace: "commandcode",
		method: "report",
		invocation: { kind: "direct" },
		parameters: [],
		result: {
			mode: "strict",
			typeSymbol: `${USAGE_REMOTE_PACKAGE}#CommandCodeAccountsReport`,
			schema: usageReportSchema
		}
	}]
};
//#endregion
//#region src/usage-remote.ts
/**
* The Remote receiver: a Cordis service the Gateway resolves by key
* (`commandcodeUsage`) and binds to the wire namespace (`commandcode`). The
* base class stamps the `typertRemote` binding the Gateway validates on every
* dispatch; no decorators are needed because the descriptor is registered
* explicitly (strict path) rather than discovered from source markers.
*/
var CommandCodeUsageService = class extends TypertRemoteService {
	deps;
	constructor(ctx, deps) {
		super(ctx, "commandcodeUsage", { namespace: "commandcode" });
		this.deps = deps;
	}
	/**
	* Account, usage, and credit state for the settings page's account card —
	* one entry per pool account when the plugin entry wired `reports`, a
	* single default-account entry otherwise. Degrades per endpoint like the
	* `/commandcode` command (failures land in `report.failures`); throws
	* `MISSING_CREDENTIAL` when no key resolves, which the Gateway folds into
	* the failure branch the page renders as a hint.
	*/
	async report() {
		if (this.deps.reports !== void 0) return this.deps.reports();
		return { accounts: [{
			id: "default",
			label: "Default",
			configured: true,
			active: true,
			mark: "",
			cooldownUntil: 0,
			report: await this.deps.adapter.getUsage()
		}] };
	}
};
/**
* Provide the usage service and register its Remote descriptor. The registry
* contribution is tied to this fiber's lifetime: the registry's own
* `register()` effect would otherwise outlive the plugin.
*/
function applyUsageRemote(ctx, deps) {
	ctx.inject(["typert"], (remoteCtx) => {
		new CommandCodeUsageService(remoteCtx, deps);
		const unregister = remoteCtx.typert.register(USAGE_HOST_CONTRIBUTION);
		remoteCtx.effect(() => () => void unregister(), "dsh-commandcode-provider: usage remote");
	});
}
//#endregion
//#region src/index.ts
/**
* dsh-commandcode-provider — DeepSeek Harness LLM provider plugin for Command
* Code (unofficial; ported from pi-commandcode-provider@0.5.1).
*
* Registers the `commandcode` provider route on `ctx.llm` and declares it in
* the configurable-provider directory, so the web Models page shows a
* "Command Code" card with an API-key field and the model picker lists the
* live Command Code model catalog. Connection facts resolve per request over
* the optional `llm-commandcode` user-settings section and the credential
* seam, so a changed key, endpoint, or cache path reaches the next request
* without a restart.
*
* ```yaml
* - id: llm-commandcode
*   name: "dsh-commandcode-provider"
*   config:
*     apiKeyEnv: COMMANDCODE_API_KEY
* ```
*
* The `name` is the full package specifier as installed in the profile's
* node_modules: the loader imports it as a module, and pnpm links packages by
* their true (scoped) name — a bare `dsh-commandcode-provider` fails to
* resolve (ERR_MODULE_NOT_FOUND) and crashes the app on boot. The value must
* be quoted in YAML: an unquoted scalar starting with `@` fails to parse.
*
* @module dsh-commandcode-provider
*/
const name = "llm-commandcode";
const inject = ["llm"];
const NS = settingsNamespace("llm-commandcode");
const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";
/** The single provider route this plugin owns. */
const PROVIDER = "commandcode";
/** Default models cache path (mirrors the pi plugin's on-disk cache). */
const DEFAULT_MODELS_CACHE_PATH = join(homedir(), ".commandcode", "models-cache.json");
const Config = z.object({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	apiKey: z.string(),
	// `baseURL` and `models` are the shared Models-page fields. `apiBase` is
	// retained as a compatibility alias for existing settings.yaml files.
	baseURL: z.string().default(DEFAULT_API_BASE),
	apiBase: z.string(),
	workingDir: z.string().default(process.cwd()),
	modelsCachePath: z.string().default(DEFAULT_MODELS_CACHE_PATH),
	requestTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
	streamIdleTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS),
	filterModelsByPlan: z.boolean(),
	models: z.array(z.object({
		id: z.string(),
		name: z.string(),
		contextWindow: z.number().min(1),
		maxTokens: z.number().min(1)
	})).default([]),
	accounts: z.array(z.object({
		label: z.string(),
		apiKeyEnv: z.string().role("credential-ref"),
		apiKey: z.string()
	})),
	activeAccount: z.string()
});
/**
* The one explicit resolve step from raw config to validated connection
* facts. Programmatic construction may bypass Schemastery normalization, so
* every default is re-judged here — for the composition entry at load and for
* each settings snapshot at its first use.
*/
function resolveAdapterOptions(config) {
	return {
		apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
		apiBase: config.baseURL ?? config.apiBase ?? "https://api.commandcode.ai",
		workingDir: config.workingDir ?? process.cwd(),
		modelsCachePath: config.modelsCachePath ?? DEFAULT_MODELS_CACHE_PATH,
		requestTimeoutMs: config.requestTimeoutMs ?? 6e4,
		streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? 3e5,
		filterModelsByPlan: config.filterModelsByPlan ?? true
	};
}
function apply(ctx, config) {
	let current = () => config;
	let lastRaw;
	let lastGood;
	const options = () => {
		const raw = current();
		if (raw === lastRaw && lastGood !== void 0) return lastGood;
		const next = resolveAdapterOptions(raw);
		lastRaw = raw;
		lastGood = next;
		return next;
	};
	options();
	const slots = () => {
		const raw = current();
		const list = [{
			id: "default",
			label: "Default",
			ref: credentialRef(raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
			literal: raw.apiKey,
			allowAuthFile: true
		}];
		for (const [index, account] of (raw.accounts ?? []).entries()) {
			const refName = typeof account.apiKeyEnv === "string" && account.apiKeyEnv.trim() !== "" ? account.apiKeyEnv.trim() : void 0;
			const literal = typeof account.apiKey === "string" && account.apiKey !== "" ? account.apiKey : void 0;
			if (refName === void 0 && literal === void 0) continue;
			list.push({
				id: refName ?? `account-${index + 2}`,
				label: typeof account.label === "string" && account.label.trim() !== "" ? account.label.trim() : `Account ${index + 2}`,
				ref: refName === void 0 ? void 0 : credentialRef(refName),
				literal,
				allowAuthFile: false
			});
		}
		return list;
	};
	const preferredId = () => {
		const raw = current().activeAccount;
		return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : void 0;
	};
	const resolveRef = async (ref) => {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0) return (await credentials.resolve(ref))?.value;
		const ambient = launchEnvironmentOf(ctx).get(ref);
		return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
	};
	const pool = new CommandCodeAccountPool({
		slots,
		resolveRef,
		authFileKey: resolveAuthFileApiKey,
		probeWindow: (apiKey) => adapter.probeFiveHourWindow(apiKey),
		preferredId
	});
	const resolveApiKey = async (connection) => {
		const resolved = await pool.resolveKey();
		if (resolved !== void 0) return assertUsableApiKey(resolved.key, "llm-commandcode", resolved.slot.ref ?? `${resolved.slot.label} (config.apiKey)`);
		const ref = connection.apiKeyEnv;
		throw new LlmError(`llm-commandcode: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials service (the web Models page writes it), export it in the launching environment, set config.apiKey, or run \`command-code login\` to write ~/.commandcode/auth.json`, "MISSING_CREDENTIAL");
	};
	const adapter = new CommandCodeAdapter({
		options,
		resolveApiKey,
		rotateApiKey: async (rejectedKey, rejection) => {
			pool.markRejected(rejectedKey, rejection);
			const resolved = await pool.resolveKey({ exclude: rejectedKey });
			return resolved === void 0 ? void 0 : assertUsableApiKey(resolved.key, "llm-commandcode", resolved.slot.ref ?? `${resolved.slot.label} (config.apiKey)`);
		},
		resolveAttachments: () => {
			const attachments = ctx.get("attachments");
			return attachments === void 0 ? void 0 : attachments;
		}
	});
	ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER,
		displayName: "Command Code",
		settingsNs: NS,
		settingsPath: []
	}]);
	ctx.llm.registerAdapter([PROVIDER], adapter);
	const usageReports = async () => {
		const described = await pool.describeAccounts();
		const byId = new Map(described.map((account) => [account.slot.id, account]));
		const active = selectActiveAccount(await pool.resolvedAccounts(), preferredId());
		return { accounts: await Promise.all(slots().map(async (slot) => {
			const account = byId.get(slot.id);
			let report;
			if (account === void 0) report = { failures: [] };
			else try {
				report = await adapter.getUsage(account.key);
			} catch (error) {
				report = { failures: [error instanceof Error ? error.message : String(error)] };
			}
			const state = account?.state;
			const usable = accountUsable(state);
			return {
				id: slot.id,
				label: slot.label,
				configured: account !== void 0,
				active: account !== void 0 && active?.slot.id === slot.id,
				mark: usable ? "" : state?.kind === "disabled" ? "invalid-credential" : "rate-limit",
				cooldownUntil: !usable && state?.kind === "cooldown" ? state.until : 0,
				report
			};
		})) };
	};
	ctx.inject(["commands"], (commandCtx) => {
		applyCommands(commandCtx, {
			adapter,
			reports: usageReports
		});
	});
	applyUsageRemote(ctx, {
		adapter,
		reports: usageReports
	});
	installSettingsSection(ctx, NS, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	// Configuration is rendered by the product's generic Models settings
	// plugin. Keep the route's live source thunk so settings mutations still
	// apply to the next request without this provider owning a second page.
}
//#endregion
export { BILLING_ACCESS_TTL_MS, COMMAND_CODE_CLI_VERSION, CommandCodeAccountPool, CommandCodeAdapter, CommandCodeUsageService, Config, DEFAULT_API_BASE, DEFAULT_GENERATE_MAX_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MODELS_CACHE_PATH, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, KNOWN_DEALS, KNOWN_EFFORTS, KNOWN_IMAGE_MODELS, KNOWN_PEAK_PRICING, KNOWN_PLANS, KNOWN_SUBSCRIPTION_PLANS, KNOWN_THINKING_MODELS, PLAN_LABELS, PLAN_ORDER, PROVIDER, USAGE_REPORT_ENDPOINT, accountUsable, apply, applyCommands, applyUsageRemote, capabilityDescription, commandDefinition, compareByPlan, dealLabel, formatContext, inject, modelVisibleInPlan, name, peakPricingLabel, peakPricingState, planLabel, projectSlugFromPath, resolveAdapterOptions, resolveAuthFileApiKey, selectActiveAccount, subscriptionPlanInfo, usageReportSchema };

//# sourceMappingURL=index.js.map
