declare const chrome: typeof browser;

export type WebExtensionApi = typeof browser & {
  sidePanel?: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    open(options: { windowId?: number; tabId?: number }): Promise<void>;
    setOptions(options: { tabId?: number; path?: string; enabled?: boolean }): Promise<void>;
  };
};

function isWebExtensionApi(candidate: unknown): candidate is WebExtensionApi {
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }

  const api = candidate as {
    runtime?: { sendMessage?: unknown };
  };
  return typeof api.runtime?.sendMessage === "function";
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
