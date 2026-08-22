import { DEFAULT_SETTINGS, type SilverGuideSettings, loadSettings } from "./shared/settings";
import { getWebExtensionApi } from "./shared/webextension";

type AssistantResult = {
  active: boolean;
  success: boolean;
  message: string;
};

type ContentState = {
  active: boolean;
};

const extensionApi = getWebExtensionApi();

async function activeTabId(): Promise<number | undefined> {
  if (extensionApi === undefined) return undefined;
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function settingsForPage(): Promise<SilverGuideSettings> {
  try {
    return await loadSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function injectContent(tabId: number): Promise<void> {
  if (extensionApi === undefined) throw new Error("WebExtension API is unavailable.");
  await extensionApi.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function enableAssistant(): Promise<AssistantResult> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return { active: false, success: false, message: "表示するページを見つけられませんでした。" };
  }

  try {
    await injectContent(tabId);
    if (extensionApi === undefined) throw new Error("WebExtension API is unavailable.");
    await extensionApi.tabs.sendMessage(tabId, {
      type: "silver-guide-enable",
      settings: await settingsForPage()
    });
    return { active: true, success: true, message: "このページの支援を開始しました。" };
  } catch (error: unknown) {
    console.error("[silver-guide] Unable to start assistance", error);
    return {
      active: false,
      success: false,
      message: "このページでは支援を開始できません。元のページは変更していません。"
    };
  }
}

async function disableAssistant(): Promise<AssistantResult> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return { active: false, success: false, message: "表示するページを見つけられませんでした。" };
  }

  try {
    if (extensionApi === undefined) throw new Error("WebExtension API is unavailable.");
    await extensionApi.tabs.sendMessage(tabId, { type: "silver-guide-disable" });
    return { active: false, success: true, message: "このページの支援を停止しました。" };
  } catch {
    return { active: false, success: true, message: "このページでは支援は表示されていません。" };
  }
}

async function assistantState(): Promise<ContentState> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return { active: false };
  }

  try {
    if (extensionApi === undefined) return { active: false };
    return (await extensionApi.tabs.sendMessage(tabId, {
      type: "silver-guide-state"
    })) as ContentState;
  } catch {
    return { active: false };
  }
}

async function updatePageSettings(settings: SilverGuideSettings): Promise<void> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return;
  }

  try {
    if (extensionApi === undefined) return;
    await extensionApi.tabs.sendMessage(tabId, { type: "silver-guide-update-settings", settings });
  } catch {
    // 支援が有効でないタブへは何もしない。
  }
}

if (extensionApi !== undefined) {
  extensionApi.runtime.onMessage.addListener((message: unknown): Promise<AssistantResult | ContentState | void> | undefined => {
    if (message === null || typeof message !== "object" || !("type" in message)) {
      return undefined;
    }

    switch (message.type) {
      case "silver-guide-enable":
        return enableAssistant();
      case "silver-guide-disable":
        return disableAssistant();
      case "silver-guide-state":
        return assistantState();
      case "silver-guide-update-settings": {
        const settings = (message as { settings?: SilverGuideSettings }).settings;
        return settings === undefined ? Promise.resolve() : updatePageSettings(settings);
      }
      default:
        return undefined;
    }
  });
}
