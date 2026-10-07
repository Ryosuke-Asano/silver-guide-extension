import { createBackgroundController } from "./background/controller";
import { getWebExtensionApi } from "./shared/webextension";

const extensionApi = getWebExtensionApi();

if (extensionApi !== undefined) {
  const sidePanel = (extensionApi as typeof extensionApi & {
    sidePanel?: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  }).sidePanel;
  const controller = createBackgroundController(extensionApi, sidePanel !== undefined);
  if (sidePanel !== undefined) {
    // Chrome opens its native panel on the user's action click, granting
    // activeTab. Assistance still starts only from the panel's start button.
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  }
  extensionApi.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const response = controller.handle(message, sender);
    if (response === undefined) return undefined;
    // Callback responses also work on Chrome 114, before Promise-returning
    // onMessage listeners were supported. Firefox accepts this form as well.
    void response.then(sendResponse).catch(() => sendResponse({
      active: false, success: false, message: "ページの案内を取得できませんでした。もう一度お試しください。"
    }));
    return true;
  });
}
