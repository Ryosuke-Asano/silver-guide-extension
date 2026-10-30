import { CONDITIONS, summarize, resultsCsv } from "./measurement-model.js";
import { demoReady, isBundledDemo, localStore, downloadRecord } from "./bundled.js";
import { recordsFile } from "./local-measurement.js";

const get = id => document.getElementById(id);
const time = value => value === null || value === undefined ? "—" : `${(value / 1000).toFixed(Math.abs(value) < 1000 ? 3 : 1)}秒`;
const platforms = { darwin: "macOS", win32: "Windows", linux: "Linux", chromeos: "ChromeOS" };
const difference = (value, percent) => value === null ? "両方式の計測待ち" : `${time(value)}${percent === null ? "" : `（${percent.toFixed(1)}%）`}`;
const states = { running: "計測中・未完了", completed: "完了", cancelled: "中止", interrupted: "中断" };
const conditionName = condition => isBundledDemo && condition === "manual" ? "支援なし" : CONDITIONS[condition];
function row(values) {
  const element = document.createElement("tr");
  for (const value of values) { const cell = document.createElement("td"); cell.textContent = String(value); element.append(cell); }
  return element;
}
async function refresh() {
  get("results-refresh").disabled = true;
  try {
    await demoReady;
    let result;
    if (isBundledDemo) result = { runs: await localStore.all() };
    else {
      const response = await fetch("/api/measurement/results"); result = await response.json();
      if (!response.ok) throw new Error(result.error);
    }
    const stats = summarize(result.runs);
    get("results-summary").replaceChildren(...stats.groups.map(group => row([conditionName(group.condition), group.count, time(group.totalMean), time(group.totalMedian), time(group.pdfMean), time(group.pdfMedian)])));
    get("results-pairs").textContent = `${stats.participants}人・${stats.pairs}組の比較`;
    get("results-total-difference").textContent = difference(stats.totalSaved, stats.totalPercent);
    get("results-pdf-difference").textContent = difference(stats.pdfSaved, stats.pdfPercent);
    get("results-runs").replaceChildren(...[...result.runs].reverse().map(run => {
      const m = run.measurements;
      return row([run.participant, `${conditionName(run.condition)}／${run.attempt}`, `${states[run.status]}${run.status === "completed" && (!m?.pdfAttached || m.pdfMs === null) ? "（PDF比較対象外）" : ""}`,
        time(m?.totalMs), time(m?.pdfMs), time(m?.sourceMs), time(m?.prepareMs), time(m?.outputMs), m?.validationFailures ?? "—", platforms[run.platform] ?? run.platform]);
    }));
    get("results-status").textContent = result.runs.length ? `${result.runs.length}件を記録。集計対象 ${stats.comparable}件 ／ PDFなし・開始不明 ${stats.excluded}件 ／ 計測中・中止・中断 ${stats.unfinished}件。` : "計測はまだありません。入力デモで「入力時間を計測」を開いて開始してください。";
  } catch (error) { get("results-status").textContent = error.message ?? "計測結果を読み込めませんでした。「更新」でもう一度お試しください。"; }
  finally { get("results-refresh").disabled = false; }
}
get("results-refresh").addEventListener("click", () => void refresh());
if (isBundledDemo) {
  get("results-transfer").hidden = false;
  document.querySelector(".yk-footer p").textContent = "記録はこのChromeプロフィールの端末内に保存されます。返却・拡張の削除・プロフィールの削除前に、CSVと移行用記録を保存してください。";
  get("results-csv").href = "#";
  get("results-csv").addEventListener("click", async event => {
    event.preventDefault();
    try { downloadRecord(resultsCsv(await localStore.all()), "silver-guide-results.csv", "text/csv;charset=utf-8"); }
    catch (error) { get("results-status").textContent = error.message; }
  });
  get("results-export").addEventListener("click", async () => {
    try { downloadRecord(JSON.stringify(recordsFile(await localStore.all()), null, 2), "silver-guide-records.json", "application/json"); }
    catch (error) { get("results-import-status").textContent = error.message; }
  });
  get("results-import").addEventListener("change", async event => {
    const input = event.target, file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("移行用記録は12MB以内のJSONファイルを選んでください。");
      const added = await localStore.import(JSON.parse(await file.text()));
      get("results-import-status").textContent = `${added}件を追加しました。同じ記録は重複しません。`;
      await refresh();
    } catch (error) { get("results-import-status").textContent = error.message ?? "記録を取り込めませんでした。"; }
    finally { input.value = ""; input.disabled = false; }
  });
}
void refresh();
