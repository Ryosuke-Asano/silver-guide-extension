import { mkdir, open, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CONDITIONS, MEASUREMENT_KEYS, validMeasurements } from "./measurement-model.js";

const exactKeys = (object, keys) => object && typeof object === "object" && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const badRequest = message => Object.assign(new Error(message), { status: 400 });

/** One demo process owns a results file, even when different ports are chosen. */
export async function lockMeasurements(filename) {
  await mkdir(dirname(filename), { recursive: true });
  const lock = filename + ".lock", token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let file;
    try {
      file = await open(lock, "wx", 0o600);
      await file.writeFile(JSON.stringify({ pid: process.pid, token }));
      await file.close();
      return async () => {
        const current = JSON.parse(await readFile(lock, "utf8").catch(error => { if (error.code === "ENOENT") return "null"; throw error; }));
        if (current?.token === token) await unlink(lock);
      };
    } catch (error) {
      await file?.close();
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(lock, "utf8")); } catch { /* An initializing owner cannot be assumed stale. */ }
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (cause) {
          if (cause.code === "ESRCH" && JSON.parse(await readFile(lock, "utf8"))?.token === owner.token) { await unlink(lock); continue; }
        }
      }
      throw new Error("別の計測デモが同じ保存先を使用中です。先に起動したデモを終了してから実行してください。");
    }
  }
  throw new Error("計測用の保存先を確保できませんでした。もう一度起動してください。");
}

/** A local, serialised journal. A temporary Chrome profile can be discarded safely. */
export function measurementStore({ filename, condition, platform = process.platform, getBuildId = async () => "" }) {
  if (!Object.hasOwn(CONDITIONS, condition)) throw new Error("Unknown measurement condition");
  let runs = [], queue = Promise.resolve(), loading;
  const load = () => loading ??= readFile(filename, "utf8").then(text => {
    const saved = JSON.parse(text);
    if (saved.schema !== 1 || !Array.isArray(saved.runs) || saved.runs.length > 10_000) throw new Error("計測ファイルの形式を確認してください。");
    runs = saved.runs.map(run => run.status === "running" ? { ...run, status: "interrupted" } : run);
  }).catch(error => { if (error.code !== "ENOENT") throw error; });
  const all = async () => { await load(); await queue; return structuredClone(runs); };
  const change = operation => {
    const next = queue.then(async () => {
      await load();
      const draft = structuredClone(runs), result = await operation(draft);
      await mkdir(dirname(filename), { recursive: true });
      await writeFile(filename + ".tmp", JSON.stringify({ schema: 1, runs: draft }, null, 2) + "\n", { mode: 0o600 });
      await rename(filename + ".tmp", filename);
      runs = draft;
      return structuredClone(result);
    });
    queue = next.catch(() => {});
    return next;
  };
  return { all, flush: () => queue, config: { enabled: true, condition }, async apply(body) {
    if (body?.action === "start" && exactKeys(body, ["action", "participant"]) && Number.isSafeInteger(body.participant) && body.participant > 0 && body.participant <= 9999) {
      const buildId = condition === "manual" ? "" : await getBuildId();
      if (typeof buildId !== "string" || buildId && !/^[a-f0-9]{64}$/u.test(buildId)) throw new Error("拡張のビルド情報を確認できません。");
      return change(draft => {
        if (draft.length >= 10_000) throw badRequest("計測が10,000件に達しました。CSVを保存して、計測ファイルを移動してください。");
        const attempt = 1 + Math.max(0, ...draft.filter(run => run.participant === body.participant && run.condition === condition).map(run => run.attempt));
        const run = { id: randomUUID(), participant: body.participant, condition, attempt, status: "running", startedAt: new Date().toISOString(), endedAt: null, measurements: null, platform, buildId };
        draft.push(run); return run;
      });
    }
    if (["finish", "cancel"].includes(body?.action) && exactKeys(body, ["action", "runId", "measurements"]) && uuid(body.runId) && validMeasurements(body.measurements)) {
      if (condition === "manual" && ["sourceMs", "prepareMs", "outputMs"].some(key => body.measurements[key] !== null)) throw badRequest("手作業の自動処理時間は記録できません。");
      return change(draft => {
        const run = draft.find(item => item.id === body.runId && item.condition === condition);
        if (!run) throw badRequest("対象の計測が見つかりません。");
        if (run.status !== "running") return run; // Idempotent retry after a lost response.
        run.status = body.action === "finish" ? "completed" : "cancelled";
        run.endedAt = new Date().toISOString();
        run.measurements = Object.fromEntries(MEASUREMENT_KEYS.map(key => [key, body.measurements[key]]));
        return run;
      });
    }
    throw badRequest("計測データの形式が正しくありません。");
  } };
}
