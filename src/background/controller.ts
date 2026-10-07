import type { AssistanceCommand, AssistanceResult, AssistanceState } from "../shared/assistant";
import { DEFAULT_SETTINGS, FONT_SIZES, loadSettings, type SilverGuideSettings } from "../shared/settings";
import type { WebExtensionApi } from "../shared/webextension";

type Request = {
  type: string;
  windowId?: number;
  tabId?: number;
  sessionId?: string;
  revision?: number;
  command?: AssistanceCommand;
  settings?: SilverGuideSettings;
};

const COMMANDS: readonly AssistanceCommand[] = ["first-field", "previous-field", "next-field", "overview", "first-error", "first-term"];
const CHANGED_PAGE = "表示するタブやページが変わりました。最新の案内を確認して、もう一度選んでください。";

function validSettings(settings: SilverGuideSettings | undefined): settings is SilverGuideSettings {
  return settings !== undefined && settings !== null && FONT_SIZES.includes(settings.fontSize) && typeof settings.showOriginal === "boolean";
}

/** No page metadata is cached or stored: the current content context owns it. */
export function createBackgroundController(api: WebExtensionApi, sidePanel: boolean) {
  const navigation = new Map<number, number>();
  api.tabs.onUpdated?.addListener((tabId, change) => {
    if (navigation.has(tabId) && (change.status === "loading" || change.url !== undefined)) {
      navigation.set(tabId, (navigation.get(tabId) ?? 0) + 1);
    }
  });
  api.tabs.onRemoved?.addListener((tabId) => navigation.delete(tabId));
  async function target(request: Request, explicit = false): Promise<number | undefined> {
    if (request.windowId !== undefined && (!Number.isInteger(request.windowId) || request.windowId < 0)) return undefined;
    if (sidePanel && explicit && (!Number.isInteger(request.tabId) || request.windowId === undefined)) return undefined;
    const [tab] = await api.tabs.query(request.windowId === undefined
      ? { active: true, currentWindow: true } : { active: true, windowId: request.windowId });
    return tab?.id !== undefined && (request.tabId === undefined || request.tabId === tab.id) ? tab.id : undefined;
  }

  async function state(tabId: number): Promise<AssistanceState> {
    try {
      const current = await api.tabs.sendMessage(tabId, { type: "silver-guide-state" }) as AssistanceState;
      return { ...current, tabId };
    } catch {
      return { active: false, tabId };
    }
  }

  function failure(message: string, current: AssistanceState = { active: false }): AssistanceResult {
    return { ...current, success: false, message };
  }

  async function assistantState(request: Request): Promise<AssistanceState> {
    const tabId = await target(request);
    return tabId === undefined ? { active: false } : state(tabId);
  }

  async function enable(request: Request): Promise<AssistanceResult> {
    const tabId = await target(request, true);
    if (tabId === undefined) return failure(CHANGED_PAGE);
    const version = navigation.get(tabId) ?? 0;
    navigation.set(tabId, version);
    try {
      const injected = await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      const topDocument = injected.find((result) => result.frameId === 0);
      const documentId = topDocument && "documentId" in topDocument && typeof topDocument.documentId === "string"
        ? topDocument.documentId : undefined;
      if (sidePanel && !documentId) return failure(CHANGED_PAGE, { active: false, tabId });
      let settings: SilverGuideSettings;
      try { settings = await loadSettings(); } catch { settings = DEFAULT_SETTINGS; }
      // Permission and settings lookups can outlive a tab switch.
      if (await target(request, true) !== tabId || navigation.get(tabId) !== version) return failure(CHANGED_PAGE, { active: false, tabId });
      const message = {
        type: "silver-guide-enable", settings, presentation: sidePanel ? "sidepanel" : "page"
      };
      // Pin activation to the injected document even if navigation happens
      // between the check above and message delivery. Chrome 106+ supports it.
      const delivery = { frameId: 0, documentId };
      const current = await (sidePanel
        ? api.tabs.sendMessage(tabId, message, delivery)
        : api.tabs.sendMessage(tabId, message)) as AssistanceState;
      return { ...current, tabId, success: true, message: "このページの支援を開始しました。" };
    } catch {
      return failure(sidePanel
        ? "このページでは支援を開始できません。通常のWebページを開き、Silver Guideの拡張アイコンを押してからもう一度お試しください。"
        : "このページでは支援を開始できません。元のページは変更していません。", { active: false, tabId });
    }
  }

  async function control(request: Request): Promise<AssistanceResult> {
    const tabId = await target(request, true);
    if (tabId === undefined) return failure(CHANGED_PAGE);
    const current = await state(tabId);
    if (sidePanel && (!current.active || request.sessionId === undefined || request.sessionId !== current.sessionId)) {
      return failure(CHANGED_PAGE, current);
    }
    if (await target(request, true) !== tabId) return failure(CHANGED_PAGE);
    try {
      if (request.type === "silver-guide-command") {
        if (!COMMANDS.includes(request.command as AssistanceCommand) || !Number.isInteger(request.revision)) return failure("この操作は利用できません。", current);
        const result = await api.tabs.sendMessage(tabId, {
          type: request.type, command: request.command, sessionId: request.sessionId, revision: request.revision
        }) as AssistanceResult;
        return { ...result, tabId };
      }
      if (request.type === "silver-guide-update-settings" && !validSettings(request.settings)) return failure("設定を確認できませんでした。", current);
      const result = await api.tabs.sendMessage(tabId, {
        type: request.type, sessionId: request.sessionId,
        ...(request.type === "silver-guide-update-settings" ? { settings: request.settings } : {})
      }) as AssistanceState;
      if (sidePanel && (request.type === "silver-guide-disable" ? result.active : result.sessionId !== request.sessionId)) return failure(CHANGED_PAGE, { ...result, tabId });
      return { ...result, tabId, success: true, message: request.type === "silver-guide-disable"
        ? "このページの支援を停止しました。" : "表示設定を更新しました。" };
    } catch {
      return failure(CHANGED_PAGE, { active: false, tabId });
    }
  }

  async function notifyPanel(sender: browser.runtime.MessageSender): Promise<void> {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (tabId === undefined || windowId === undefined || sender.frameId !== 0) return;
    if (await target({ type: "", windowId, tabId }) !== tabId) return;
    // A wake-up only. The panel fetches the current session, so late messages
    // from a replaced document cannot reinstall an old snapshot.
    await api.runtime.sendMessage({ type: "silver-guide-panel-update", tabId, windowId }).catch(() => undefined);
  }

  return {
    handle(message: unknown, sender: browser.runtime.MessageSender): Promise<AssistanceState | AssistanceResult | void> | undefined {
      if (message === null || typeof message !== "object" || !("type" in message)) return undefined;
      const request = message as Request;
      if (request.type === "silver-guide-page-updated") return notifyPanel(sender);
      // Content contexts may announce updates, but never request privileged
      // injection or control another tab through the background.
      if (sender.tab !== undefined) return undefined;
      switch (request.type) {
        case "silver-guide-state": return assistantState(request);
        case "silver-guide-enable": return enable(request);
        case "silver-guide-disable":
        case "silver-guide-update-settings":
        case "silver-guide-command": return control(request);
        default: return undefined;
      }
    }
  };
}
