import { demoReady, isBundledDemo } from "./bundled.js";
await demoReady;
const status = document.getElementById("setup-build");
if (isBundledDemo) {
  try {
    const info = await fetch("../build-info.json").then(response => response.json());
    status.textContent = `比較デモ ${info.version} ／ ビルド ${info.sourceHash.slice(0, 12)}`;
  } catch { status.textContent = "ビルド情報を確認できません。拡張を読み込み直してください。"; }
} else status.textContent = "この画面は、比較デモ同封版のChrome拡張から開いてください。";
