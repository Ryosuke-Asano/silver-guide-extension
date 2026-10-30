import { startPageHelpers } from "../page-content";
import { assistedDemoUrl } from "../shared/bundled-demo";
import { getWebExtensionApi } from "../shared/webextension";

export async function startBundledDemo(): Promise<void> {
  const api = getWebExtensionApi();
  if (!api || !assistedDemoUrl(location.href, api.runtime.getURL(""))) return;
  const tab = await api.tabs.getCurrent();
  if (tab?.id === undefined || tab.url !== location.href) throw new Error("デモのタブを確認できませんでした。開き直してください。");
  startPageHelpers(api, tab.id);
}
