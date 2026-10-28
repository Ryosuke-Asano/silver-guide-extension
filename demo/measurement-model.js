export const CONDITIONS = { manual: "通常の手作業", "silver-guide": "Silver Guideあり" };
export const MAX_DURATION_MS = 86_400_000;
export const MEASUREMENT_KEYS = ["totalMs", "pdfMs", "pdfAttached", "validationFailures", "pdfOpens", "sourceMs", "prepareMs", "outputMs"];
const duration = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DURATION_MS;
const optionalDuration = value => value === null || duration(value);

/** Reject unknown fields: this endpoint never accepts answers, filenames or PDFs. */
export function validMeasurements(value) {
  return value && typeof value === "object" && Object.keys(value).length === MEASUREMENT_KEYS.length && MEASUREMENT_KEYS.every(key => Object.hasOwn(value, key))
    && duration(value.totalMs) && optionalDuration(value.pdfMs) && (value.pdfMs === null || value.pdfMs <= value.totalMs)
    && typeof value.pdfAttached === "boolean" && (value.pdfAttached || value.pdfMs === null)
    && [value.validationFailures, value.pdfOpens].every(count => Number.isSafeInteger(count) && count >= 0 && count <= 10_000)
    && [value.sourceMs, value.prepareMs, value.outputMs].every(optionalDuration);
}
export const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function summarize(runs) {
  // Both conditions must finish the same task, including the PDF attachment.
  const comparable = runs.filter(run => run.status === "completed" && run.measurements?.pdfAttached && run.measurements.pdfMs !== null);
  const groups = Object.keys(CONDITIONS).map(condition => {
    const rows = comparable.filter(run => run.condition === condition);
    return { condition, count: rows.length, totalMean: mean(rows.map(run => run.measurements.totalMs)), totalMedian: median(rows.map(run => run.measurements.totalMs)),
      pdfMean: mean(rows.map(run => run.measurements.pdfMs)), pdfMedian: median(rows.map(run => run.measurements.pdfMs)) };
  });
  const pairs = [];
  for (const key of new Set(comparable.map(run => `${run.participant}:${run.platform}`))) {
    const conditionRuns = condition => comparable.filter(run => `${run.participant}:${run.platform}` === key && run.condition === condition).sort((a, b) => a.attempt - b.attempt);
    const manual = conditionRuns("manual"), assisted = conditionRuns("silver-guide");
    for (let index = 0; index < Math.min(manual.length, assisted.length); index++) {
      const before = manual[index].measurements, after = assisted[index].measurements;
      pairs.push({ participant: manual[index].participant, totalSaved: before.totalMs - after.totalMs, pdfSaved: before.pdfMs - after.pdfMs,
        totalPercent: before.totalMs > 0 ? 100 * (before.totalMs - after.totalMs) / before.totalMs : null,
        pdfPercent: before.pdfMs > 0 ? 100 * (before.pdfMs - after.pdfMs) / before.pdfMs : null });
    }
  }
  return { groups, comparable: comparable.length, excluded: runs.filter(run => run.status === "completed").length - comparable.length,
    unfinished: runs.filter(run => run.status !== "completed").length, pairs: pairs.length, participants: new Set(pairs.map(pair => pair.participant)).size,
    totalSaved: median(pairs.map(pair => pair.totalSaved)), pdfSaved: median(pairs.map(pair => pair.pdfSaved)),
    totalPercent: median(pairs.flatMap(pair => pair.totalPercent === null ? [] : [pair.totalPercent])), pdfPercent: median(pairs.flatMap(pair => pair.pdfPercent === null ? [] : [pair.pdfPercent])) };
}
export function resultsCsv(runs) {
  const seconds = value => value === null || value === undefined ? "" : (value / 1000).toFixed(3);
  const rows = [["run_id", "participant", "condition", "attempt", "status", "started_at", "ended_at", "total_seconds", "pdf_seconds", "pdf_attached", "pdf_fetch_seconds", "pdf_prepare_seconds", "pdf_output_seconds", "validation_failures", "pdf_opens", "platform", "build_id"]];
  for (const run of runs) {
    const m = run.measurements;
    rows.push([run.id, run.participant, run.condition, run.attempt, run.status, run.startedAt, run.endedAt ?? "", seconds(m?.totalMs), seconds(m?.pdfMs), m?.pdfAttached ?? "",
      seconds(m?.sourceMs), seconds(m?.prepareMs), seconds(m?.outputMs), m?.validationFailures ?? "", m?.pdfOpens ?? "", run.platform, run.buildId]);
  }
  return "\ufeff" + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}
