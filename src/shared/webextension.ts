declare const chrome: typeof browser;

export type WebExtensionApi = typeof browser;

function isWebExtensionApi(candidate: unknown): candidate is WebExtensionApi {
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }

  const api = candidate as {
    runtime?: { sendMessage?: unknown };
    storage?: { local?: unknown };
  };
  return typeof api.runtime?.sendMessage === "function" && api.storage?.local !== undefined;
}

export function getWebExtensionApi(): WebExtensionApi | undefined {
  if (typeof browser !== "undefined" && isWebExtensionApi(browser)) {
    return browser;
  }
  if (typeof chrome !== "undefined" && isWebExtensionApi(chrome)) {
    return chrome;
  }
  return undefined;
}
