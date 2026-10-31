import { DEMO_SITE_URL } from "../src/shared/demo-site";
document.getElementById("demo-site-link").href = DEMO_SITE_URL;
try {
  const info = await fetch("../build-info.json").then(response => response.json());
  document.getElementById("setup-build").textContent = `Silver Guide ${info.version} ／ ビルド ${info.sourceHash.slice(0, 12)}`;
} catch { document.getElementById("setup-build").textContent = "拡張を読み込み直してください。"; }
