import { getWebExtensionApi } from "./webextension";

/** Only this extension's packaged demo is an additional page context. */
export function bundledDemoUrl(value: unknown, root = getWebExtensionApi()?.runtime.getURL("")): URL | null {
  if (typeof value !== "string" || value.length > 8192 || !root) return null;
  try {
    const url = new URL(value), own = new URL(root);
    return ["chrome-extension:", "moz-extension:"].includes(own.protocol) && url.protocol === own.protocol
      && url.host === own.host && !url.username && !url.password ? url : null;
  } catch { return null; }
}
export function assistedDemoUrl(value: unknown, root?: string): string | null {
  const url = bundledDemoUrl(value, root);
  return url?.pathname === "/demo/index.html" && url.searchParams.get("condition") === "silver-guide" ? url.href : null;
}
export function bundledPdfUrl(value: unknown, root?: string): boolean {
  const url = bundledDemoUrl(value, root);
  return !!url && ["/demo/assets/library-application-original.pdf", "/demo/assets/library-application-fillable.pdf"].includes(url.pathname);
}
