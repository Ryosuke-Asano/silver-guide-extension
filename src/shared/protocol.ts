export const PRODUCT_VERSION = "3.0.0";
export function publicHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function trustedExtensionSender(sender: browser.runtime.MessageSender, root: string, extensionId: string, paths: readonly string[]): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try { const actual = new URL(sender.url); const expected = new URL(root); return actual.protocol === expected.protocol && actual.host === expected.host && paths.includes(actual.pathname.replace(/^\//, "")); } catch { return false; }
}
export function trustedBackgroundSender(sender:browser.runtime.MessageSender,root:string,extensionId:string):boolean {
  if(sender.id!==extensionId||sender.tab)return false;
  if(!sender.url)return true;
  return trustedExtensionSender(sender,root,extensionId,["background.js","_generated_background_page.html"]);
}
