import { credentialRef } from "@deepseek-ai/dsh-credentials";
//#region src/live-discovery.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
const MODELS_DEV_URL = "https://models.dev/api.json";
const MODELS_DEV_TTL_MS = 3e5;
const MODELS_DEV_HEADERS = {
	accept: "application/json",
	"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};
let modelsDevCache;
let masterCatalogCache;
async function masterCatalog() {
	if (masterCatalogCache !== void 0) return masterCatalogCache;
	const candidates = [new URL("../../../product/config/model-catalog.json", import.meta.url), new URL("./model-catalog.json", import.meta.url)];
	for (const url of candidates) {
		try {
			const res = await fetch(url);
			if (res.ok) {
				const json = await res.json();
				if (json?.models && typeof json.models === "object") {
					masterCatalogCache = json.models;
					return masterCatalogCache;
				}
			}
		} catch {}
		try {
			const { readFileSync } = await import("node:fs");
			const { dirname, resolve } = await import("node:path");
			const { fileURLToPath } = await import("node:url");
			const fsCandidates = [
				resolve(dirname(fileURLToPath(import.meta.url)), "../../../product/config/model-catalog.json"),
				resolve(process.cwd(), "product/config/model-catalog.json"),
				resolve(new URL(".", import.meta.url).pathname, "../product/config/model-catalog.json")
			];
			for (const p of fsCandidates) try {
				const raw = readFileSync(p, "utf8");
				const json = JSON.parse(raw);
				if (json?.models && typeof json.models === "object") {
					masterCatalogCache = json.models;
					return masterCatalogCache;
				}
			} catch {}
		} catch {}
	}
	masterCatalogCache = {};
	return masterCatalogCache;
}
function providerKey(provider) {
	return provider.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function modelInfoToDiscovered(model) {
	return {
		id: model.id,
		name: model.name
	};
}
/** Apply the saved model selection to every provider's shared runtime catalog. */
function configuredModels(settings, llm, provider, models) {
	const entry = llm.listConfigurableProviders().find((candidate) => candidate.provider === provider);
	if (entry === void 0 || entry.settingsNs.length === 0) return [...models];
	const section = settings.get(entry.settingsNs);
	if (!isRecord(section)) return [...models];
	let profile = section;
	for (const segment of entry.settingsPath) {
		if (!isRecord(profile)) return [...models];
		profile = profile[segment];
	}
	if (!isRecord(profile) || !Array.isArray(profile["models"])) return [...models];
	const selected = new Set(profile["models"].flatMap((model) => isRecord(model) && typeof model["id"] === "string" ? [model["id"]] : []));
	return models.filter((model) => selected.has(model.id));
}
function positiveInteger(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
async function modelsDevCatalog(provider, signal) {
	const now = Date.now();
	if (modelsDevCache !== void 0 && modelsDevCache.expires > now) return readModelsDevProvider(modelsDevCache.data, provider);
	const response = await fetch(MODELS_DEV_URL, {
		signal,
		headers: MODELS_DEV_HEADERS
	});
	if (!response.ok) throw new Error(`Models.dev returned HTTP ${response.status}`);
	const data = await response.json();
	modelsDevCache = {
		expires: now + MODELS_DEV_TTL_MS,
		data
	};
	return readModelsDevProvider(data, provider);
}
function readModelsDevProvider(data, provider) {
	if (!isRecord(data)) return [];
	const wanted = providerKey(provider);
	const aliases = /* @__PURE__ */ new Set([wanted, wanted.replace(/-relay$|-(tokens|gateway|api)$/g, "")]);
	const raw = Object.entries(data).find(([key]) => aliases.has(providerKey(key)))?.[1];
	if (!isRecord(raw)) return [];
	const models = raw["models"];
	if (!isRecord(models)) return [];
	const result = [];
	for (const [id, value] of Object.entries(models)) if (isRecord(value)) {
		const name = typeof value["alias"] === "string" ? value["alias"] : typeof value["display_name"] === "string" ? value["display_name"] : typeof value["name"] === "string" ? value["name"] : void 0;
		const limit = isRecord(value["limit"]) ? value["limit"] : void 0;
		const contextWindow = limit === void 0 ? void 0 : positiveInteger(limit["context"]);
		const maxTokens = limit === void 0 ? void 0 : positiveInteger(limit["output"]);
		result.push({
			id,
			...name === void 0 ? {} : { name },
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens }
		});
	} else result.push({ id });
	return result;
}
/** Merge public metadata into a supplier directory without replacing supplier ids or labels. */
async function enrichMissingMetadata(provider, models, signal) {
	if (provider.length === 0 || models.length === 0 || models.every((model) => model.name !== void 0 && model.contextWindow !== void 0 && model.maxTokens !== void 0)) return models;
	let fallback;
	try {
		fallback = await modelsDevCatalog(provider, signal);
	} catch {
		fallback = void 0;
	}
	let master;
	try {
		master = await masterCatalog();
	} catch {
		master = void 0;
	}
	const byId = fallback ? new Map(fallback.map((model) => [model.id, model])) : /* @__PURE__ */ new Map();
	return models.map((model) => {
		const supplement = byId.get(model.id);
		const masterEntry = master?.[model.id];
		const name = supplement?.name ?? (masterEntry !== void 0 ? masterEntry.name : void 0);
		const contextWindow = supplement?.contextWindow ?? masterEntry?.contextWindow;
		const maxTokens = supplement?.maxTokens ?? masterEntry?.maxTokens;
		if (supplement === void 0 && masterEntry === void 0) return model;
		return {
			...model,
			...model.name === void 0 && name !== void 0 ? { name } : {},
			...model.contextWindow === void 0 && contextWindow !== void 0 ? { contextWindow } : {},
			...model.maxTokens === void 0 && maxTokens !== void 0 ? { maxTokens } : {}
		};
	});
}
/**
* Ask one draft route for its current provider directory. `undefined` means
* the live source was unavailable, so the caller may use the official static
* catalog as a fallback.
*/
async function discoverLiveModels(discover, settings, credentials, settingsNs, request) {
	if (request.baseURL === void 0 || request.baseURL.length === 0) return void 0;
	const apiKey = request.provider === void 0 ? request.apiKey : request.apiKey ?? await storedApiKey(settings, credentials, settingsNs, request.provider);
	const { provider: _provider, ...endpointRequest } = request;
	try {
		return await discover(settingsNs, apiKey === void 0 ? endpointRequest : {
			...endpointRequest,
			apiKey
		});
	} catch (error) {
		if (request.signal?.aborted) throw error;
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
		const originalListModels = llm.listModels.bind(llm);
		const originalResolveModelInfo = llm.resolveModelInfo.bind(llm);
		const filteredListModels = async (provider) => configuredModels(services.settings, llm, provider, await originalListModels(provider));
		const enrichedResolveModelInfo = async (provider, model, signal) => {
			const resolved = await originalResolveModelInfo(provider, model, signal);
			if (resolved.inputModalities !== void 0) return resolved;
			const entry = (await originalListModels(provider)).find((candidate) => candidate.id === model);
			return entry?.inputModalities === void 0 ? resolved : {
				...resolved,
				inputModalities: [...entry.inputModalities]
			};
		};
		const richListModels = async (provider) => {
			const listed = await originalListModels(provider);
			const enriched = [];
			for (const model of listed) try {
				const info = await llm.resolveModelInfo(provider, model.id);
				enriched.push({
					id: model.id,
					name: model.name,
					...info.context?.contextWindow === void 0 ? {} : { contextWindow: info.context.contextWindow },
					...info.defaultMaxTokens === void 0 ? {} : { maxTokens: info.defaultMaxTokens }
				});
			} catch {
				enriched.push(modelInfoToDiscovered(model));
			}
			return enriched;
		};
		const wrapped = async function(settingsNs, request) {
			const live = await discoverLiveModels((namespace, liveRequest) => original.call(llm, namespace, liveRequest), services.settings, services.credentials, settingsNs, request);
			if (live !== void 0) return [...await enrichMissingMetadata(request.provider ?? "", live, request.signal)];
			try {
				const originalModels = await original.call(llm, settingsNs, request);
				return [...await enrichMissingMetadata(request.provider ?? "", originalModels, request.signal)];
			} catch (error) {
				if (request.signal?.aborted) throw error;
			}
			if (request.provider !== void 0) {
				try {
					const listed = await richListModels(request.provider);
					if (listed.length > 0) return listed;
				} catch (error) {
					if (request.signal?.aborted) throw error;
				}
				try {
					const fallback = await modelsDevCatalog(request.provider, request.signal);
					if (fallback.length > 0) return [...fallback];
				} catch (error) {
					if (request.signal?.aborted) throw error;
				}
			}
			throw new Error(`no model directory is available for provider "${request.provider ?? ""}"`);
		};
		llm.discoverModels = wrapped;
		llm.listModels = filteredListModels;
		llm.resolveModelInfo = enrichedResolveModelInfo;
		services.effect(() => () => {
			if (llm.discoverModels === wrapped) llm.discoverModels = original;
			if (llm.listModels === filteredListModels) llm.listModels = originalListModels;
			if (llm.resolveModelInfo === enrichedResolveModelInfo) llm.resolveModelInfo = originalResolveModelInfo;
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

//# sourceMappingURL=index.js.map