import { demoReady, isBundledDemo } from "./bundled.js";
await demoReady;
const participant = document.getElementById("setup-participant");
const initial = new URLSearchParams(location.search).get("participant");
if (/^[1-9][0-9]{0,3}$/u.test(initial ?? "")) participant.value = initial;
const choices = document.querySelectorAll('a[href*="index.html?condition="]');
function updateParticipant() {
  const valid = participant.validity.valid, number = Number(participant.value);
  document.getElementById("setup-order").textContent = valid
    ? `参加者${number}：${number % 2 ? "支援なし → Silver Guideあり" : "Silver Guideあり → 支援なし"} の順です。`
    : "参加者番号を1〜9999の整数で入力してください。";
  for (const link of choices) {
    const url = new URL(link.href);
    if (valid) url.searchParams.set("participant", String(number));
    else url.searchParams.delete("participant");
    link.href = url.href;
  }
}
participant.addEventListener("input", updateParticipant);
for (const link of choices) link.addEventListener("click", event => {
  if (!participant.reportValidity()) event.preventDefault();
});
updateParticipant();
const status = document.getElementById("setup-build");
if (isBundledDemo) {
  try {
    const info = await fetch("../build-info.json").then(response => response.json());
    status.textContent = `比較デモ ${info.version} ／ ビルド ${info.sourceHash.slice(0, 12)}`;
  } catch { status.textContent = "ビルド情報を確認できません。拡張を読み込み直してください。"; }
} else status.textContent = "この画面は、比較デモ同封版のChrome拡張から開いてください。";
