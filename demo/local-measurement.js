import { CONDITIONS, MEASUREMENT_KEYS, validMeasurements } from "./measurement-model.js";

const exact = (value, keys) => value && typeof value === "object" && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const date = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
const fields = ["id", "participant", "condition", "attempt", "status", "startedAt", "endedAt", "measurements", "platform", "buildId"];
const invalid = () => new Error("計測データの形式を確認してください。入力内容などを含むファイルは取り込めません。");
export function validRun(run) {
  return exact(run, fields) && uuid(run.id) && Number.isSafeInteger(run.participant) && run.participant > 0 && run.participant <= 9999
    && Object.hasOwn(CONDITIONS, run.condition) && Number.isSafeInteger(run.attempt) && run.attempt > 0 && run.attempt <= 10_000
    && ["running", "completed", "cancelled", "interrupted"].includes(run.status) && date(run.startedAt)
    && (run.status === "running" || run.status === "interrupted" ? run.endedAt === null && run.measurements === null : date(run.endedAt) && validMeasurements(run.measurements))
    && (run.condition !== "manual" || run.measurements === null || ["sourceMs", "prepareMs", "outputMs"].every(key => run.measurements[key] === null))
    && ["chromeos", "darwin", "win32", "linux"].includes(run.platform)
    && typeof run.buildId === "string" && (run.buildId === "" || /^[a-f0-9]{64}$/u.test(run.buildId));
}
export function parseRecords(value) {
  if (!exact(value, ["schema", "kind", "runs"]) || value.schema !== 1 || value.kind !== "silver-guide-comparison" || !Array.isArray(value.runs)
    || value.runs.length > 10_000 || !value.runs.every(validRun) || new Set(value.runs.map(run => run.id)).size !== value.runs.length) throw invalid();
  // Reconstruct known properties so imported objects cannot add private fields.
  return value.runs.map(run => Object.fromEntries(fields.map(key => [key, key === "measurements" && run[key]
    ? Object.fromEntries(MEASUREMENT_KEYS.map(name => [name, run[key][name]])) : run[key]])));
}
export function recordsFile(runs) { return { schema: 1, kind: "silver-guide-comparison", runs }; }
export function detectPlatform(userAgent) {
  return /CrOS/u.test(userAgent) ? "chromeos" : /Windows/u.test(userAgent) ? "win32" : /Macintosh|Mac OS/u.test(userAgent) ? "darwin" : "linux";
}

/** A read/write transaction serializes tabs. No storage permission or server. */
export function localMeasurementStore(view) {
  let opening;
  const db = () => opening ??= new Promise((resolve, reject) => {
    const request = view.indexedDB.open("silver-guide-comparison", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("runs", { keyPath: "id" });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => { opening = undefined; reject(new Error("計測用の保存先を開けません。通常のChromeプロフィールを使い、空き容量を確認してください。")); };
    request.onblocked = () => reject(new Error("別のデモ画面を閉じてから、もう一度お試しください。"));
  });
  const transaction = async (mode, operation) => {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("runs", mode), store = tx.objectStore("runs"), request = store.getAll();
      let result, failure;
      request.onsuccess = () => {
        try { result = operation(request.result, store); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? new Error("計測結果を保存できません。空き容量を確認して再試行してください。"));
    });
  };
  return {
    all: () => transaction("readonly", runs => runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))),
    async apply(body, condition, buildId = "") {
      if (!Object.hasOwn(CONDITIONS, condition)) throw invalid();
      if (body?.action === "start" && exact(body, ["action", "participant"]) && Number.isSafeInteger(body.participant) && body.participant > 0 && body.participant <= 9999) {
        if (buildId && !/^[a-f0-9]{64}$/u.test(buildId)) throw invalid();
        return transaction("readwrite", (runs, store) => {
          if (runs.length >= 10_000) throw new Error("記録が10,000件に達しました。記録を書き出してください。");
          const run = { id: view.crypto.randomUUID(), participant: body.participant, condition,
            attempt: 1 + Math.max(0, ...runs.filter(run => run.participant === body.participant && run.condition === condition).map(run => run.attempt)),
            status: "running", startedAt: new Date().toISOString(), endedAt: null, measurements: null,
            platform: detectPlatform(view.navigator.userAgent), buildId: condition === "manual" ? "" : buildId };
          store.add(run); return run;
        });
      }
      if (["finish", "cancel"].includes(body?.action) && exact(body, ["action", "runId", "measurements"]) && uuid(body.runId) && validMeasurements(body.measurements)) {
        if (condition === "manual" && ["sourceMs", "prepareMs", "outputMs"].some(key => body.measurements[key] !== null)) throw invalid();
        return transaction("readwrite", (runs, store) => {
          const run = runs.find(run => run.id === body.runId && run.condition === condition);
          if (!run) throw new Error("対象の計測が見つかりません。");
          if (run.status !== "running") return run;
          run.status = body.action === "finish" ? "completed" : "cancelled";
          run.endedAt = new Date().toISOString();
          run.measurements = Object.fromEntries(MEASUREMENT_KEYS.map(key => [key, body.measurements[key]]));
          store.put(run); return run;
        });
      }
      throw invalid();
    },
    import(value) {
      const incoming = parseRecords(value);
      return transaction("readwrite", (runs, store) => {
        const known = new Map(runs.map(run => [run.id, run]));
        let added = 0;
        for (const run of incoming) {
          const current = known.get(run.id);
          if (current) {
            // A stale export must not overwrite a record completed locally.
            if (current.status === "running" && run.status !== "running") store.put(run);
            continue;
          }
          if (known.size >= 10_000) throw new Error("取り込み後の記録が10,000件を超えます。");
          store.add(run); known.set(run.id, run); added++;
        }
        return added;
      });
    }
  };
}
