import { credentialRef } from "@deepseek-ai/dsh-credentials";
//#region src/live-discovery.ts
/** OpenAI-compatible protocols expose the common `/models` listing shape. */
const LISTABLE_PROTOCOLS = /* @__PURE__ */ new Set(["openai-completions", "openai-responses"]);
/** Bound a provider response so a broken endpoint cannot grow the host heap. */
const MAX_RESPONSE_BYTES = 4194304;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textField(...values) {
	for (const value of values) if (typeof value === "string" && value.length > 0) return value;
}
function capacity(...values) {
	for (const value of values) if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
}
function listingUrl(baseURL) {
	return `${baseURL.replace(/\/+$/u, "")}/models`;
}
async function readBounded(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		await response.body?.cancel();
		return;
	}
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) return void 0;
			chunks.push(value);
		}
	} catch {
		return;
	} finally {
		await reader.cancel().catch(() => void 0);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}
function parseListing(body) {
	const data = (isRecord(body) ? body : {})["data"];
	if (!Array.isArray(data)) return void 0;
	const models = [];
	for (const raw of data) {
		if (!isRecord(raw)) continue;
		const entry = raw;
		const id = textField(entry.id);
		if (id === void 0) continue;
		const name = textField(entry.name, entry.display_name);
		const contextWindow = capacity(entry.context_window, entry.context_length);
		const maxTokens = capacity(entry.max_output_tokens, entry.max_tokens);
		models.push({
			id,
			...name === void 0 ? {} : { name },
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens }
		});
	}
	return models;
}
/** Read the model route's credential reference from the registered settings. */
function credentialReference(settings, settingsNs, provider) {
	const section = settings.get(settingsNs);
	if (!isRecord(section)) return void 0;
	const profile = provider !== void 0 && isRecord(section["providers"]) ? section["providers"][provider] : section;
	if (!isRecord(profile)) return void 0;
	const reference = profile["apiKeyEnv"];
	return typeof reference === "string" && reference.length > 0 ? reference : void 0;
}
async function storedApiKey(settings, credentials, settingsNs, provider) {
	const reference = credentialReference(settings, settingsNs, provider);
	if (reference === void 0) return void 0;
	try {
		return (await credentials.resolve(credentialRef(reference)))?.value;
	} catch {
		return;
	}
}
/**
* Ask one draft route for its current provider directory. `undefined` means
* the live source was unavailable, so the caller may use the official static
* catalog as a fallback.
*/
async function discoverLiveModels(settings, credentials, settingsNs, request) {
	if (request.baseURL === void 0 || request.baseURL.length === 0) return void 0;
	const api = request.api ?? "openai-completions";
	if (!LISTABLE_PROTOCOLS.has(api)) return void 0;
	const apiKey = request.apiKey ?? await storedApiKey(settings, credentials, settingsNs, request.provider);
	const headers = { accept: "application/json" };
	if (apiKey !== void 0 && apiKey.trim().length > 0) headers["authorization"] = `Bearer ${apiKey.trim()}`;
	let response;
	try {
		response = await fetch(listingUrl(request.baseURL), {
			method: "GET",
			headers,
			...request.signal === void 0 ? {} : { signal: request.signal }
		});
	} catch {
		return;
	}
	if (!response.ok) return void 0;
	const text = await readBounded(response);
	if (text === void 0) return void 0;
	try {
		return parseListing(JSON.parse(text));
	} catch {
		return;
	}
}
/** Install the live-first behavior without changing the official LLM runtime. */
function installLiveModelDiscovery(ctx) {
	ctx.inject([
		"llm",
		"settings",
		"credentials"
	], (services) => {
		const llm = services.llm;
		const original = llm.discoverModels;
		const wrapped = async function(settingsNs, request) {
			const live = await discoverLiveModels(services.settings, services.credentials, settingsNs, request);
			if (live !== void 0) return [...live];
			return original.call(llm, settingsNs, request);
		};
		llm.discoverModels = wrapped;
		services.effect(() => () => {
			if (llm.discoverModels === wrapped) llm.discoverModels = original;
		}, "dsh-model-settings: live model discovery");
	});
}
//#endregion
//#region src/index.ts
/** Host entry: add live provider directories behind the existing LLM seam. */
function apply(ctx) {
	installLiveModelDiscovery(ctx);
}
//#endregion
export { apply };

//# sourceMappingURL=index.mjs.map