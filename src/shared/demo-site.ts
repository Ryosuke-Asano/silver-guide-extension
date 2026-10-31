export const DEMO_SITE_URL = "https://ryosuke-asano.github.io/silver-guide-extension/";

/** Only the published mock's form may opt in to its simulated completion. */
export function isPublishedDemoForm(value: string): boolean {
  try {
    const url = new URL(value), base = new URL(DEMO_SITE_URL);
    return !url.username && !url.password && url.origin === base.origin
      && [base.pathname, base.pathname + "index.html"].includes(url.pathname);
  } catch { return false; }
}
