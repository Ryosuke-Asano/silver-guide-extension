import { localMeasurementStore } from "./local-measurement.js";

const extension = globalThis.browser ?? globalThis.chrome;
const ownRoot = extension?.runtime?.getURL?.("");
export const isBundledDemo = !!ownRoot && new URL(ownRoot).protocol === location.protocol && new URL(ownRoot).host === location.host
  && ["chrome-extension:", "moz-extension:"].includes(location.protocol) && location.pathname.startsWith("/demo/");
export const demoCondition = new URLSearchParams(location.search).get("condition");
export const isPractice = isBundledDemo && new URLSearchParams(location.search).get("practice") === "1";
export const localStore = isBundledDemo ? localMeasurementStore(window) : null;

export const demoReady = (async () => {
  if (!isBundledDemo) return;
  const isForm = location.pathname === "/demo/index.html";
  if (isForm && !["manual", "silver-guide"].includes(demoCondition)) { location.replace("setup.html"); return; }
  for (const link of document.querySelectorAll("a[href]")) {
    const url = new URL(link.href);
    if (url.protocol !== location.protocol || url.host !== location.host) continue;
    if (url.pathname === "/demo/") url.pathname = "/demo/index.html";
    if (["/demo/index.html", "/demo/guide.html"].includes(url.pathname) && ["manual", "silver-guide"].includes(demoCondition)) {
      url.searchParams.set("condition", demoCondition);
      if (isPractice) url.searchParams.set("practice", "1");
      const participant = new URLSearchParams(location.search).get("participant");
      if (/^[1-9][0-9]{0,3}$/u.test(participant ?? "")) url.searchParams.set("participant", participant);
    }
    if (url.pathname === "/demo/index.html" && !url.searchParams.has("condition")) url.pathname = "/demo/setup.html";
    link.href = url.href;
  }
  const timingLaunch = document.getElementById("timing-launch");
  if (timingLaunch) timingLaunch.textContent = "比較デモの入口で「支援なし」または「Silver Guideあり」を選びます。支援なしでは、この画面の入力補助を停止します。同じ参加者番号で両方式を試してください。";
  const webSteps = document.getElementById("web-check-steps");
  if (webSteps) {
    webSteps.children[0].textContent = "比較デモの入口で「支援なし」を選び、入力・確認・修正を試します。";
    webSteps.children[1].textContent = "次に入口から「Silver Guideあり」を開きます。";
  }
  if (!isForm) return;
  const mode = document.createElement("p");
  mode.id = "bundled-mode"; mode.className = "yk-bundled-mode";
  const label = document.createElement("strong"), change = document.createElement("a");
  label.textContent = `${isPractice ? "練習（記録しません） ／ " : ""}${demoCondition === "manual" ? "支援なし（入力補助を停止）" : "Silver Guideあり"}`;
  const participant = new URLSearchParams(location.search).get("participant");
  change.href = /^[1-9][0-9]{0,3}$/u.test(participant ?? "") ? `setup.html?participant=${participant}` : "setup.html";
  change.textContent = isPractice ? "練習を終えて開始画面へ" : "方式を選び直す";
  mode.append(label, change);
  document.querySelector(".yk-mock-notice").before(mode);
  const measurement = document.getElementById("measurement");
  if (measurement) measurement.open = true;
  if (demoCondition === "silver-guide") {
    const { startBundledDemo } = await import("../src/demo/entry.ts");
    await startBundledDemo();
  }
})();

export function downloadRecord(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
