const extension = globalThis.browser ?? globalThis.chrome;
const ownRoot = extension?.runtime?.getURL?.("");
export const isBundledDemo = !!ownRoot && new URL(ownRoot).protocol === location.protocol && new URL(ownRoot).host === location.host
  && ["chrome-extension:", "moz-extension:"].includes(location.protocol) && location.pathname.startsWith("/demo/");
export const demoCondition = new URLSearchParams(location.search).get("condition");

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
    }
    if (url.pathname === "/demo/index.html" && !url.searchParams.has("condition")) url.pathname = "/demo/setup.html";
    link.href = url.href;
  }
  const webSteps = document.getElementById("web-check-steps");
  if (webSteps) {
    webSteps.children[0].textContent = "比較デモの入口で「支援なし」を選び、入力・確認・修正を試します。";
    webSteps.children[1].textContent = "次に入口から「Silver Guideあり」を開きます。";
  }
  if (!isForm) return;
  document.title += `｜${demoCondition === "manual" ? "支援なし" : "Silver Guideあり"}`;
  const footer = document.querySelector(".yk-footer");
  if (footer) {
    const back = document.createElement("a");
    back.href = "setup.html"; back.textContent = "デモの開始画面へ";
    const paragraph = document.createElement("p"); paragraph.append(back); footer.append(paragraph);
  }
  if (demoCondition === "silver-guide") {
    const { startBundledDemo } = await import("../src/demo/entry.ts");
    await startBundledDemo();
  }
})();
