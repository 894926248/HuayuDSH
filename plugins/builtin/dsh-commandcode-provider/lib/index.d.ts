import z from "@deepseek-ai/schemastery";
import { GenerateOptions, LlmAdapter, LlmModelInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
import { CredentialRef } from "@deepseek-ai/dsh-credentials";
import { TypertRemoteService, TypertSchema } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import { CommandDefinition } from "@deepseek-ai/dsh-commands";
//#region src/adapter.d.ts
declare const KNOWN_EFFORTS: Readonly<Record<string, readonly string[]>>;
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
declare const KNOWN_IMAGE_MODELS: ReadonlySet<string>;
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
declare const KNOWN_THINKING_MODELS: ReadonlySet<string>;
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
declare const KNOWN_PLANS: Readonly<Record<string, string>>;
/** Official display labels for each plan tier. */
declare const PLAN_LABELS: Readonly<Record<string, string>>;
/**
 * Plan-tier sort weights, low to high. Models outside the snapshot (unknown
 * plans) sort after every known tier, keeping known models predictable.
 */
declare const PLAN_ORDER: Readonly<Record<string, number>>;
/**
 * Comparator for the model picker: sort by plan tier (lowest first), then by
 * model name, then by id as a tiebreak. Models with no known plan sort last.
 */
declare function compareByPlan(a: {
  id: string;
  name: string;
}, b: {
  id: string;
  name: string;
}): number;
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
declare const KNOWN_SUBSCRIPTION_PLANS: Readonly<Record<string, {
  name: string;
  monthlyCredits: number;
  tierWeight: number;
}>>;
/**
 * Resolve a subscription `planId` (e.g. `individual-pro-v1`) to its display
 * name and monthly credit total, mirroring the CLI's `getPlanInfo`:
 * normalize (lowercase, `_` → `-`), then longest-prefix match so
 * `individual-pro-v1` wins over `individual-pro`. Unknown ids return
 * `undefined`.
 */
declare function subscriptionPlanInfo(planId: string): {
  name: string;
  monthlyCredits: number;
  tierWeight: number;
} | undefined;
/**
 * The billing facts the picker's plan filter needs, fetched by mirroring the
 * CLI's `createBilling` flow (whoami → orgId, then `/alpha/billing/subscriptions`
 * for the plan id and `/alpha/billing/credits` for the on-demand balances).
 */
interface CommandCodeBillingAccess {
  /** Account plan tier weight on the {@link PLAN_ORDER} scale; undefined when the plan is unknown. */
  tierWeight: number | undefined;
  /**
   * Purchased + free on-demand credit balance. The official access model
   * (`evaluateModelAccess` in the CLI) allows every model when the account
   * holds any on-demand credits — the plan gate only applies at zero balance.
   */
  onDemandCredits: number;
}
/**
 * Whether the picker lists `modelId` for an account with the given billing
 * access. Fails open at every uncertainty: no billing data, an unknown plan,
 * or a model outside {@link KNOWN_PLANS} all keep the model visible — the
 * server remains the final gate (`403 MODEL_NOT_IN_PLAN`).
 */
declare function modelVisibleInPlan(modelId: string, access: CommandCodeBillingAccess | undefined): boolean;
/**
 * Active pricing deals per the official pricing page
 * (`/docs/resources/pricing-limits#deals`). Each entry records the model's
 * promotional label and — critically — when it expires, so the picker never
 * shows a stale discount after the plugin's snapshot has gone out of date.
 *
 * - `expiresAt` is an ISO timestamp. When it is in the past (checked at
 *   render time against `Date.now()`), the deal label is hidden until the
 *   snapshot is refreshed from the official page. `undefined` means
 *   "no expiry" (permanent).
 * - `free` marks models whose requests cost no credits (Laguna S 2.1), shown
 *   as a `FREE` badge; it degrades to a plain discount once the deal lapses.
 *
 * Keep in sync with the official pricing page when deals change (see the
 * dsh-commandcode-upstream skill).
 */
interface KnownDeal {
  /** Promotional label, e.g. "50% off" or "2× usage". */
  label: string;
  /** Deal end date (ISO). `undefined` = permanent / no expiry. */
  expiresAt?: string;
  /** Model is free (requests cost no credits). */
  free?: boolean;
}
declare const KNOWN_DEALS: Readonly<Record<string, KnownDeal>>;
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
declare const KNOWN_PEAK_PRICING: ReadonlySet<string>;
/**
 * Whether `now` (defaults to `Date.now()`) falls in a peak-pricing hour for
 * time-of-day-priced models. `undefined` for models outside the snapshot.
 */
declare function peakPricingState(modelId: string, now?: number): 'peak' | 'off-peak' | undefined;
/**
 * Compact label for the current peak/off-peak state: `Peak` (full price) or
 * `Half` (off-peak, half price). These English nouns match the picker's other
 * markers (`Go`, `Image`, `FREE`), and since they appear only on time-of-day
 * priced models they double as a "priced by the hour" signal. Returns undefined
 * for models without time-of-day pricing.
 */
declare function peakPricingLabel(modelId: string, now?: number): string | undefined;
declare const COMMAND_CODE_CLI_VERSION = "1.31.0";
declare const DEFAULT_API_BASE = "https://api.commandcode.ai";
declare const DEFAULT_GENERATE_MAX_TOKENS = 200000;
declare const DEFAULT_MAX_OUTPUT_TOKENS = 200000;
/** How long the picker's plan-filter billing facts stay cached before refetching. */
declare const BILLING_ACCESS_TTL_MS: number;
/** Head-of-request timeout: how long to wait for the first response byte. */
declare const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
/** Stream idle timeout: a generation that stalls this long is a dead connection. */
declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/**
 * Official display label for a model's minimum plan, or undefined for models
 * outside the snapshot (e.g. future catalog additions).
 */
declare function planLabel(modelId: string): string | undefined;
/**
 * The active deal label for a model, or undefined when the model has no deal
 * or the deal has expired. Expiry is judged against `now` (defaults to
 * `Date.now()`), so a snapshot that has gone stale stops showing its discount
 * the moment the official end date passes — the user never believes a lapsed
 * deal is still live. Permanent deals (no `expiresAt`) never lapse.
 */
declare function dealLabel(modelId: string, now?: number): string | undefined;
/**
 * Compact human-readable context window, e.g. `1_000_000 -> "1M"`,
 * `256_000 -> "256K"`, `262_144 -> "256K"` (floor to the nearest K).
 * Returns undefined for unknown/absent sizes.
 */
declare function formatContext(contextWindow: number | undefined): string | undefined;
/**
 * Compact one-line summary for the model picker: plan tier, then any active
 * deal (discount or FREE), then the current peak/off-peak state (`Peak`/`Half`)
 * for time-of-day-priced models, then `Image` for Vision-capable models, then
 * the context window. Text-only models simply omit the Image marker — "Text
 * only" adds nothing the picker needs to show.
 */
declare function capabilityDescription(modelId: string, contextWindow?: number, now?: number): string;
declare function projectSlugFromPath(pathName: string): string;
/** Read a usable Command Code credential from the official CLI auth file. */
declare function resolveAuthFileApiKey(): string | undefined;
/** Connection facts resolved fresh per request by the plugin entry. */
interface CommandCodeConnectionOptions {
  /** API base; the Provider API lives under it (`/alpha/generate`, `/provider/v1/models`). */
  apiBase: string;
  /** Working directory reported to the API (project slug, config block). */
  workingDir: string;
  /** Model catalog cache path. */
  modelsCachePath: string;
  /**
   * Milliseconds to wait for generate response headers / first byte (default 60s).
   * Must not bound the subsequent body stream — long generations are gated by
   * {@link streamIdleTimeoutMs} and the caller AbortSignal instead.
   */
  requestTimeoutMs: number;
  /** Milliseconds a stream may stall before it is treated as a dead connection (default 300s). */
  streamIdleTimeoutMs: number;
  /**
   * Whether the picker hides models above the account's subscription tier
   * (default true). The filter fails open: unknown plan, billing-endpoint
   * failure, a positive on-demand credit balance, or an unmapped model all
   * keep the full catalog visible. Set false to always list every model.
   */
  filterModelsByPlan?: boolean;
}
/**
 * Resolve the durable attachment service, or undefined when the host does not
 * provide one. Called lazily only when a request actually carries images, so a
 * text-only request never depends on the attachment seam.
 */
type ResolveAttachments = () => AttachmentStore | undefined;
/** Everything the adapter needs beyond the request itself. */
interface CommandCodeAdapterDeps<C extends CommandCodeConnectionOptions = CommandCodeConnectionOptions> {
  /** Resolve the current connection facts (fresh per request, settings-aware). */
  options: () => C;
  /** Resolve a usable API key for the given connection facts, or throw `MISSING_CREDENTIAL`. */
  resolveApiKey: (connection: C) => Promise<string>;
  /**
   * Multi-account rotation hook: the request sent with `rejectedKey` was
   * refused with 429 (`rate-limit`) or 401 (`invalid-credential`) before
   * any response body streamed. The host marks that key and returns the next
   * account's key to retry with, or `undefined` to surface the failure.
   * Only pre-stream rejections rotate — a mid-stream failure never replays a
   * partially consumed generation against another account.
   */
  rotateApiKey?: (rejectedKey: string, rejection: 'rate-limit' | 'invalid-credential', connection: C) => Promise<string | undefined>;
  /** HTTP transport override (tests); defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Resolve the optional durable attachment service for image input (tests); defaults to none. */
  resolveAttachments?: ResolveAttachments;
}
/** Account identity from `/alpha/whoami`. */
interface CommandCodeAccount {
  id: string;
  name: string;
  userName: string;
}
/** Usage summary from `/alpha/usage/summary`. */
interface CommandCodeUsage {
  totalCount: number;
  totalCost: number;
  successRate: number;
  completedCount: number;
  failedCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCredits: number;
  periodBasis: string;
}
/** Credit/limit state from `/alpha/billing/credits`. */
interface CommandCodeCredits {
  monthlyCredits: number;
  purchasedCredits: number;
  freeCredits: number;
  /** Five-hour rolling window limits. */
  fiveHour: {
    used: number;
    cap: number;
    exceeded: boolean;
    resetAt: number;
  };
  /** Weekly window limits. */
  weekly: {
    used: number;
    cap: number;
    exceeded: boolean;
    resetAt: number;
  };
}
/** Subscription plan state from `/alpha/billing/subscriptions`. */
interface CommandCodePlan {
  /** Raw subscription plan id (e.g. `individual-pro`); empty when unreported. */
  planId: string;
  /** Display name (e.g. `Pro`); falls back to the raw id for unknown plans. */
  name: string;
  /** Raw subscription status (`active`, `trialing`, `past_due`, …); empty when unreported. */
  status: string;
  /** The plan's monthly credit total per {@link KNOWN_SUBSCRIPTION_PLANS}; null for unknown plans. */
  monthlyCredits: number | null;
  /** Billing period end in millis; 0 when the endpoint did not report one. */
  currentPeriodEnd: number;
}
/** Everything the usage endpoints report, fetched together. */
interface CommandCodeUsageReport {
  account?: CommandCodeAccount;
  usage?: CommandCodeUsage;
  credits?: CommandCodeCredits;
  plan?: CommandCodePlan;
  /** Endpoint failures degrade the report instead of failing it. */
  failures: string[];
}
declare class CommandCodeAdapter<C extends CommandCodeConnectionOptions = CommandCodeConnectionOptions> extends LlmAdapter {
  private readonly deps;
  private catalog;
  private readonly fetchImpl;
  private readonly resolveAttachments;
  private readonly billingAccess;
  private readonly billingAccessInflight;
  constructor(deps: CommandCodeAdapterDeps<C>);
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
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
  /** Refresh the catalog (live fetch, cache fallback) and return it. */
  private loadCatalog;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
  /** The headers every authenticated account endpoint shares. */
  private accountHeaders;
  /**
   * The billing facts behind the picker's plan filter, cached for
   * {@link BILLING_ACCESS_TTL_MS} and shared across concurrent callers.
   * `undefined` means "unknown — show everything" (fail-open).
   */
  private loadBillingAccess;
  /**
   * The billing facts behind the picker's plan filter, mirroring the CLI's
   * `createBilling` flow: whoami yields the org id, then the subscriptions
   * and credits endpoints answer in parallel. The plan id is honored only
   * when the subscription reports an active-ish status (the CLI's rule); when
   * the subscriptions endpoint fails entirely, `credits.planId` is the
   * fallback (the CLI stamps plan identity from it too). Any failure resolves
   * to `undefined` (fail-open) rather than breaking the picker.
   */
  private fetchBillingAccess;
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
  getUsage(apiKey?: string): Promise<CommandCodeUsageReport>;
  /**
   * Probe one account's five-hour window from `/alpha/billing/credits`. The
   * multi-account pool calls this when every account is marked exhausted: an
   * account whose window no longer reports `exceeded` is revived, and the
   * `resetAt` values feed the "earliest reset" error message. Returns
   * `undefined` when the probe itself failed (transport, non-200, or a
   * payload without window limits) — a failed probe never changes pool state.
   */
  probeFiveHourWindow(apiKey: string): Promise<{
    exceeded: boolean;
    resetAt: number;
  } | undefined>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//#endregion
//#region src/accounts.d.ts
/** One extra account's raw configuration (composition config or settings). */
interface CommandCodeAccountConfig {
  /** Display label shown in the usage dashboard and settings page. */
  label?: string;
  /** Credential reference (environment-variable style name) holding this account's API key. */
  apiKeyEnv?: string;
  /** Literal API key (composition config only; never stored in settings). */
  apiKey?: string;
}
/** One account slot after config normalization. */
interface CommandCodeAccountSlot {
  /** Stable id: `default` for the implicit first account, `account-N` for extras. */
  id: string;
  /** Display label (user-provided or generated). */
  label: string;
  /** Credential reference resolved through the seam; undefined for literal-only slots. */
  ref?: CredentialRef | undefined;
  /** Literal key from composition config. */
  literal?: string | undefined;
  /** Whether the official CLI auth file may back this slot (default slot only). */
  allowAuthFile: boolean;
}
/** Why a key stopped serving requests. */
type AccountRejection = 'rate-limit' | 'invalid-credential';
/** One key's rotation state. */
interface CommandCodeAccountState {
  kind:
  /** Marked by a 429; the window's reset time is unknown until probed. */
  'unknown' |
  /** Probed (or marked with a known reset): unusable until `until` (millis). */
  'cooldown' |
  /** Marked by a 401: skipped until the stored credential changes. */
  'disabled';
  /** Human-readable reason for the mark (e.g. `rate limited (429)`). */
  reason: string;
  /** Cooldown end in millis; 0 for the other kinds. */
  until: number;
}
/** A slot paired with its resolved key (both pool-internal and UI-facing). */
interface ResolvedAccount {
  slot: CommandCodeAccountSlot;
  key: string;
  /** The key's current rotation state; undefined means usable. */
  state: CommandCodeAccountState | undefined;
}
/** Five-hour window facts probed from `/alpha/billing/credits`. */
interface FiveHourWindowProbe {
  exceeded: boolean;
  resetAt: number;
}
/** Everything the pool needs from the host; all seams are injected. */
interface CommandCodeAccountPoolDeps {
  /** The current account slots, re-read per resolution so settings changes apply live. */
  slots(): readonly CommandCodeAccountSlot[];
  /** Resolve one credential reference through the credentials service or the launch environment. */
  resolveRef(ref: CredentialRef): Promise<string | undefined>;
  /** The official CLI auth-file key (`~/.commandcode/auth.json`); default slot only. */
  authFileKey(): string | undefined;
  /** Probe one key's five-hour window; undefined when the probe itself failed. */
  probeWindow(apiKey: string): Promise<FiveHourWindowProbe | undefined>;
  /**
   * The manually selected account (a slot id, e.g. `default` or an extra's
   * credential reference), re-read per resolution. The preferred account
   * serves whenever it is usable; an unknown id or an exhausted preferred
   * account falls back to the first usable slot.
   */
  preferredId?(): string | undefined;
}
/**
 * Whether an account with this rotation state can serve a request right now.
 * `undefined` (never rejected) is usable; a cooldown becomes usable again
 * once its reset time passes; `unknown` (429, reset unprobed) and
 * `disabled` (401) are not.
 */
declare function accountUsable(state: CommandCodeAccountState | undefined): boolean;
/**
 * Pick the account that should serve now: the manually preferred slot when it
 * is usable, otherwise the first usable account in rotation order; undefined
 * when no account is usable. Shared by the pool (request path) and the plugin
 * entry (the usage view's active badge) so both always agree.
 */
declare function selectActiveAccount(accounts: readonly ResolvedAccount[], preferredId: string | undefined): ResolvedAccount | undefined;
/**
 * The account pool. Rotation state is keyed by API key (never logged), so two
 * slots resolving to the same credential share one mark, and a key changed in
 * the credentials service starts with a clean slate.
 */
declare class CommandCodeAccountPool {
  private readonly deps;
  /** Rotation state by API key. */
  private readonly states;
  constructor(deps: CommandCodeAccountPoolDeps);
  /**
   * Resolve every slot's key, deduplicated by key (first slot wins). Slots
   * without any resolvable key are omitted — they still appear in the
   * settings page as unconfigured, they just cannot serve requests.
   */
  resolvedAccounts(): Promise<ResolvedAccount[]>;
  /**
   * Every slot paired with its resolved key and rotation state — NOT
   * deduplicated: two slots sharing one credential both appear (the usage
   * view reports them individually), while slots without any resolvable key
   * are omitted. The serving path uses {@link resolvedAccounts} instead.
   */
  describeAccounts(): Promise<ResolvedAccount[]>;
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
  resolveKey(options?: {
    exclude?: string;
  }): Promise<{
    key: string;
    slot: CommandCodeAccountSlot;
  } | undefined>;
  /**
   * Record a rejection against one key. `rate-limit` (429) marks the key
   * exhausted with an unknown reset (probed lazily at the next resolution
   * once every account is marked); `invalid-credential` (401) disables the
   * key until the stored credential changes.
   */
  markRejected(apiKey: string, rejection: AccountRejection): void;
  /** One account's key: literal → credential seam → auth file (default slot). */
  private resolveSlotKey;
  /** Hand out the chosen account's key. */
  private pick;
}
//#endregion
//#region src/usage-wire.d.ts
/** One account's usage entry in the multi-account report. */
interface CommandCodeAccountUsage {
  /** Stable slot id (`default`, `account-2`, …). */
  id: string;
  /** Display label (user-provided or generated). */
  label: string;
  /** Whether an API key resolved for this account. */
  configured: boolean;
  /** Whether this account currently serves requests (first usable slot). */
  active: boolean;
  /** Rotation mark: `''` (usable), `'rate-limit'`, or `'invalid-credential'`. */
  mark: string;
  /** Known cooldown end in millis; 0 when unknown or not cooling down. */
  cooldownUntil: number;
  /** The per-account report; `failures`-only when the fetch itself failed. */
  report: CommandCodeUsageReport;
}
/** The settings page's account card data: one entry per configured account. */
interface CommandCodeAccountsReport {
  accounts: CommandCodeAccountUsage[];
}
/** Canonical `<namespace>/<method>` endpoint of the usage report Remote. */
declare const USAGE_REPORT_ENDPOINT = "commandcode/report";
/**
 * The strict result codec both halves attach to the descriptor. Hand-rolled:
 * the client bundle may not require a schema library, and `TypertSchema` is
 * deliberately minimal so one `parse` function satisfies it.
 */
declare const usageReportSchema: TypertSchema<CommandCodeAccountsReport>;
//#endregion
//#region src/commands.d.ts
/** Everything the command needs beyond the adapter itself. */
interface CommandCodeCommandDeps<C extends CommandCodeConnectionOptions = CommandCodeConnectionOptions> {
  /** The registered adapter (for getUsage / listModels). */
  adapter: CommandCodeAdapter<C>;
  /**
   * Multi-account report source (wired by the plugin entry). Absent in
   * programmatic setups, the command falls back to a single
   * `adapter.getUsage()` report.
   */
  reports?: () => Promise<CommandCodeAccountsReport>;
}
/** The one registered `/commandcode` command. */
declare function commandDefinition<C extends CommandCodeConnectionOptions>(deps: CommandCodeCommandDeps<C>): CommandDefinition;
/** Register the command on `ctx.commands` (called from the plugin entry). */
declare function applyCommands<C extends CommandCodeConnectionOptions>(ctx: Context, deps: CommandCodeCommandDeps<C>): void;
//#endregion
//#region src/usage-remote.d.ts
/** Everything the usage service needs beyond its Cordis context. */
interface CommandCodeUsageDeps<C extends CommandCodeConnectionOptions = CommandCodeConnectionOptions> {
  /** The registered adapter (for getUsage). */
  adapter: CommandCodeAdapter<C>;
  /**
   * Multi-account report source (wired by the plugin entry). Absent in
   * programmatic setups, the service falls back to a single default-account
   * entry around `adapter.getUsage()`.
   */
  reports?: () => Promise<CommandCodeAccountsReport>;
}
/**
 * The Remote receiver: a Cordis service the Gateway resolves by key
 * (`commandcodeUsage`) and binds to the wire namespace (`commandcode`). The
 * base class stamps the `typertRemote` binding the Gateway validates on every
 * dispatch; no decorators are needed because the descriptor is registered
 * explicitly (strict path) rather than discovered from source markers.
 */
declare class CommandCodeUsageService<C extends CommandCodeConnectionOptions = CommandCodeConnectionOptions> extends TypertRemoteService {
  private readonly deps;
  constructor(ctx: Context, deps: CommandCodeUsageDeps<C>);
  /**
   * Account, usage, and credit state for the settings page's account card —
   * one entry per pool account when the plugin entry wired `reports`, a
   * single default-account entry otherwise. Degrades per endpoint like the
   * `/commandcode` command (failures land in `report.failures`); throws
   * `MISSING_CREDENTIAL` when no key resolves, which the Gateway folds into
   * the failure branch the page renders as a hint.
   */
  report(): Promise<CommandCodeAccountsReport>;
}
/**
 * Provide the usage service and register its Remote descriptor. The registry
 * contribution is tied to this fiber's lifetime: the registry's own
 * `register()` effect would otherwise outlive the plugin.
 */
declare function applyUsageRemote<C extends CommandCodeConnectionOptions>(ctx: Context, deps: CommandCodeUsageDeps<C>): void;
//#endregion
//#region src/index.d.ts
declare const name = "llm-commandcode";
declare const inject: string[];
/** The single provider route this plugin owns. */
declare const PROVIDER = "commandcode";
/** Default models cache path (mirrors the pi plugin's on-disk cache). */
declare const DEFAULT_MODELS_CACHE_PATH: string;
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-commandcode` settings-section shape. Every field is optional:
 * a missing API key resolves through {@link Config.apiKeyEnv} at each request
 * (the web Models page writes it), with the official Command Code CLI auth
 * file (`~/.commandcode/auth.json`) as the last fallback.
 */
interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `COMMANDCODE_API_KEY`. */
  apiKeyEnv?: string;
  /** Literal API key override (composition config only); takes precedence over `apiKeyEnv`. */
  apiKey?: string;
  /** API base; defaults to the public Command Code Provider API. */
  apiBase?: string;
  /** Working directory reported to the API; defaults to the process cwd. */
  workingDir?: string;
  /** Model catalog cache path; defaults to `~/.commandcode/models-cache.json`. */
  modelsCachePath?: string;
  /** Milliseconds to wait for the generate response's first byte; defaults to 60s. */
  requestTimeoutMs?: number;
  /** Milliseconds a stream may stall before being treated as a dead connection; defaults to 300s. */
  streamIdleTimeoutMs?: number;
  /**
   * Whether the model picker hides models above the account's subscription
   * tier; defaults to true. The filter fails open (unknown plan, billing
   * endpoint failure, or a positive on-demand credit balance all keep the
   * full catalog visible). Set false to always list every model.
   */
  filterModelsByPlan?: boolean;
  /**
   * Extra accounts for multi-account rotation. The top-level
   * `apiKey`/`apiKeyEnv` (plus the CLI auth file) always form the first
   * (`default`) account; each entry here adds one more. When a request is
   * rejected pre-stream with 429 (usage window exhausted) or 401, the next
   * account's key retried transparently; when every account is exhausted the
   * request fails with a `RATE_LIMIT` error naming the earliest window
   * reset. Entries without `apiKey` or `apiKeyEnv` are ignored.
   */
  accounts?: CommandCodeAccountConfig[];
  /**
   * Manually selected active account: a slot id — `default`, or an extra
   * account's credential reference (e.g. `COMMANDCODE_API_KEY_2`). The
   * selected account serves whenever it is usable; an unknown id or an
   * exhausted selected account falls back to the first usable slot (automatic
   * rotation still applies). Unset means "first usable account".
   */
  activeAccount?: string;
}
declare const Config: z<Config>;
/** One resolution's complete request facts: connection plus credential reference. */
interface ResolvedCommandCodeOptions extends CommandCodeConnectionOptions {
  apiKeyEnv: CredentialRef;
}
/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default is re-judged here — for the composition entry at load and for
 * each settings snapshot at its first use.
 */
declare function resolveAdapterOptions(config: Config): ResolvedCommandCodeOptions;
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { BILLING_ACCESS_TTL_MS, COMMAND_CODE_CLI_VERSION, type CommandCodeAccountConfig, CommandCodeAccountPool, type CommandCodeAccountSlot, type CommandCodeAccountState, type CommandCodeAccountUsage, type CommandCodeAccountsReport, CommandCodeAdapter, type CommandCodeAdapterDeps, type CommandCodeBillingAccess, type CommandCodeCommandDeps, type CommandCodeConnectionOptions, type CommandCodeUsageDeps, type CommandCodeUsageReport, CommandCodeUsageService, Config, DEFAULT_API_BASE, DEFAULT_GENERATE_MAX_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MODELS_CACHE_PATH, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, KNOWN_DEALS, KNOWN_EFFORTS, KNOWN_IMAGE_MODELS, KNOWN_PEAK_PRICING, KNOWN_PLANS, KNOWN_SUBSCRIPTION_PLANS, KNOWN_THINKING_MODELS, PLAN_LABELS, PLAN_ORDER, PROVIDER, type ResolveAttachments, ResolvedCommandCodeOptions, USAGE_REPORT_ENDPOINT, accountUsable, apply, applyCommands, applyUsageRemote, capabilityDescription, commandDefinition, compareByPlan, dealLabel, formatContext, inject, modelVisibleInPlan, name, peakPricingLabel, peakPricingState, planLabel, projectSlugFromPath, resolveAdapterOptions, resolveAuthFileApiKey, selectActiveAccount, subscriptionPlanInfo, usageReportSchema };
//# sourceMappingURL=index.d.ts.map
