import { CONDITIONS, MAX_DURATION_MS } from "./measurement-model.js";
import { demoReady, demoCondition, isBundledDemo, isPractice, localStore } from "./bundled.js";

/** Only counters and elapsed times leave this controller, never form values. */
export function initializeMeasurement(doc, resetForm) {
  const root = doc.getElementById("measurement"), view = doc.defaultView;
  const noop = { attached() {}, cleared() {}, validationFailure() {}, complete() {}, reset() {} };
  if (!root || !view || typeof view.fetch !== "function" || isPractice) return noop;
  const get = id => doc.getElementById(id), start = get("measurement-start"), stop = get("measurement-stop"), retry = get("measurement-retry"), participant = get("measurement-participant"), status = get("measurement-status");
  const participantParam = new URLSearchParams(view.location.search).get("participant");
  if (isBundledDemo && /^[1-9][0-9]{0,3}$/u.test(participantParam ?? "")) participant.value = participantParam;
  let config, run = null, frozen = null, saving = false, timer;
  const showStatus = message => {
    status.textContent = message;
    if (isBundledDemo && get("complete-measurement-status")) get("complete-measurement-status").textContent = message;
  };
  const now = () => view.performance.now();
  const elapsed = () => Math.min(MAX_DURATION_MS, Math.max(0, Math.round(now() - run.started)));
  const report = () => {
    const timings = [...run.timings.values()];
    const sum = key => timings.length ? Math.min(MAX_DURATION_MS, timings.reduce((total, value) => total + value[key], 0)) : null;
    return { totalMs: elapsed(), pdfMs: run.attachedAt !== null && run.pdfAt !== null ? run.attachedAt - run.pdfAt : null,
      pdfAttached: run.attachedAt !== null, validationFailures: run.validationFailures, pdfOpens: run.pdfOpens,
      sourceMs: sum("sourceMs"), prepareMs: sum("prepareMs"), outputMs: sum("outputMs") };
  };
  const api = async body => {
    if (isBundledDemo) return localStore.apply(body, demoCondition, config?.buildId ?? "");
    const response = await view.fetch("/api/measurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result.run;
  };
  const controls = () => {
    start.disabled = !config || !!run || saving; participant.disabled = !!run || saving;
    stop.hidden = !run || !!frozen; retry.hidden = !frozen || saving;
    if (isBundledDemo) {
      const locked = !run || !!frozen || saving;
      for (const id of ["input-stage", "review-stage"]) if (get(id)) get(id).inert = locked;
      if (get("measurement-gate")) get("measurement-gate").hidden = !locked || !get("complete-stage")?.hidden;
    }
  };
  controls();
  const save = async () => {
    if (!run || !frozen || saving) return;
    saving = true; controls();
    try {
      const result = await api({ action: frozen.action, runId: run.id, measurements: frozen.measurements });
      const m = result.measurements;
      showStatus(result.status === "completed" ? `記録しました：1周 ${(m.totalMs / 1000).toFixed(1)}秒${m.pdfMs === null ? "（PDF作業は比較対象外）" : ` ／ PDF作業 ${(m.pdfMs / 1000).toFixed(1)}秒`}` : "中止した計測を記録しました。完了時間の集計には含めません。");
      if (isBundledDemo && result.status === "completed" && get("measurement-next")) {
        const next = get("measurement-next-condition"), other = demoCondition === "manual" ? "silver-guide" : "manual";
        next.href = `index.html?condition=${other}&participant=${result.participant}`;
        next.textContent = `同じ参加者で${other === "manual" ? "支援なし" : "Silver Guideあり"}へ`;
        get("measurement-next-participant").href = `setup.html?participant=${Math.min(9999, result.participant + 1)}`;
        get("complete-measurement-status").textContent += " 両方式を1回ずつ終えたら、計測結果を確認して次の参加者へ進んでください。";
        get("measurement-next").hidden = false;
      }
      doc.documentElement.removeAttribute("data-silver-guide-measure");
      run = null; frozen = null;
    } catch (error) { showStatus(`${error.message ?? "計測結果を保存できませんでした。"}ページ上部の「保存を再試行」を押してください。`); }
    finally { saving = false; controls(); }
  };
  const finish = action => {
    if (!run || frozen) return;
    clearInterval(timer);
    get("measurement-elapsed").textContent = "";
    frozen = { action, measurements: report() };
    showStatus("計測結果を保存しています…");
    void save();
  };
  start.addEventListener("click", async () => {
    if (run || saving) return;
    if (!participant.reportValidity()) return;
    saving = true; controls();
    try {
      if (get("measurement-next")) get("measurement-next").hidden = true;
      // The button explicitly clears inputs, so both conditions begin equally.
      resetForm();
      const started = now();
      const record = await api({ action: "start", participant: Number(participant.value) });
      run = { id: record.id, started, pdfAt: null, attachedAt: null, pdfOpens: 0, validationFailures: 0, timings: new Map() };
      doc.documentElement.setAttribute("data-silver-guide-measure", "");
      showStatus(`計測中：参加者 ${record.participant} ／ ${isBundledDemo && config.condition === "manual" ? "支援なし" : CONDITIONS[config.condition]}`);
      const tick = () => { get("measurement-elapsed").textContent = `経過 ${Math.floor(elapsed() / 1000)}秒`; };
      tick(); timer = setInterval(tick, 1000);
      root.open = true;
    } catch (error) { status.textContent = error.message ?? "計測を開始できませんでした。"; }
    finally { saving = false; controls(); }
  });
  stop.addEventListener("click", () => finish("cancel"));
  retry.addEventListener("click", () => void save());
  // Capture sees the generic extension button even when its shadow handler
  // stops propagation. The ordinary PDF download uses the same start boundary.
  doc.addEventListener("click", event => {
    if (!run || frozen) return;
    if (event.target?.closest?.("#pdf-download,[data-silver-guide-pdf-entry]")) {
      run.pdfAt ??= elapsed(); run.pdfOpens = Math.min(10_000, run.pdfOpens + 1);
    }
  }, true);
  doc.addEventListener("silver-guide-pdf-timing", event => {
    if (!run || frozen || run.pdfAt === null || config.condition !== "silver-guide") return;
    let value; try { value = JSON.parse(event.detail); } catch { return; }
    if (!value || typeof value.id !== "string" || value.id.length > 50 || ![value.sourceMs, value.prepareMs, value.outputMs].every(time => Number.isSafeInteger(time) && time >= 0 && time <= MAX_DURATION_MS) || run.timings.size >= 100) return;
    run.timings.set(value.id, { sourceMs: value.sourceMs, prepareMs: value.prepareMs, outputMs: value.outputMs });
  });
  view.addEventListener("pagehide", () => {
    if (!run) return;
    const body = { action: frozen?.action ?? "cancel", runId: run.id, measurements: frozen?.measurements ?? report() };
    clearInterval(timer); run = null; frozen = null;
    doc.documentElement.removeAttribute("data-silver-guide-measure");
    if (isBundledDemo) void api(body).catch(() => {}); // Uncommitted runs remain excluded after an abrupt browser exit.
    else view.navigator.sendBeacon?.("/api/measurement", new Blob([JSON.stringify(body)], { type: "application/json" }));
    status.textContent = "ページを離れたため、計測を終了しました。"; controls();
  });
  start.disabled = true;
  const configuration = async () => {
    await demoReady;
    if (!isBundledDemo) return view.fetch("/api/measurement/config").then(response => response.json());
    const info = await view.fetch("../build-info.json").then(response => response.json());
    if (!/^[a-f0-9]{64}$/u.test(info.sourceHash)) throw new Error("ビルド情報を確認できません。");
    return { enabled: true, condition: demoCondition, buildId: info.sourceHash };
  };
  void configuration().then(value => {
    if (!value.enabled || !Object.hasOwn(CONDITIONS, value.condition)) return;
    config = value;
    get("measurement-condition").textContent = isBundledDemo && value.condition === "manual" ? "支援なし" : CONDITIONS[value.condition];
    root.hidden = false; get("measurement-results-link").hidden = false;
    controls();
  }).catch(error => {
    if (isBundledDemo) { root.hidden = false; status.textContent = error.message ?? "計測を準備できません。デモを開き直してください。"; }
    // An ordinary standalone static mock can operate without measurement.
  });
  return {
    attached() { if (run && !frozen) run.attachedAt = elapsed(); },
    cleared() { if (run && !frozen) run.attachedAt = null; },
    validationFailure() { if (run && !frozen) run.validationFailures = Math.min(10_000, run.validationFailures + 1); },
    complete() { finish("finish"); },
    reset() { finish("cancel"); queueMicrotask(controls); }
  };
}
