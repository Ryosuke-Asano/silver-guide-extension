import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockMeasurements, measurementStore } from "../../demo/measurement-store.mjs";
import { resultsCsv, summarize } from "../../demo/measurement-model.js";
import { listenDemoServer } from "../../demo/server.mjs";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const metrics = (overrides = {}) => ({ totalMs: 90_000, pdfMs: 60_000, pdfAttached: true, validationFailures: 0, pdfOpens: 1, sourceMs: null, prepareMs: null, outputMs: null, ...overrides });
async function storage(condition = "manual", filename) {
  if (!filename) { const directory = await mkdtemp(join(tmpdir(), "silver-guide-metrics-")); cleanups.push(() => rm(directory, { recursive: true, force: true })); filename = join(directory, "runs.json"); }
  return { filename, store: measurementStore({ filename, condition, platform: "test", getBuildId: async () => "a".repeat(64) }) };
}
async function complete(store, participant, measurements) {
  const run = await store.apply({ action: "start", participant });
  return store.apply({ action: "finish", runId: run.id, measurements });
}

it("prevents two demo processes from overwriting the same result file", async () => {
  const { filename } = await storage(), release = await lockMeasurements(filename);
  try { await expect(lockMeasurements(filename)).rejects.toThrow("使用中"); }
  finally { await release(); }
  const restarted = await lockMeasurements(filename); await restarted();
});

it("recovers the measurement lock after its owning process has exited", async () => {
  const { filename } = await storage(), exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  expect(exited.status).toBe(0);
  await writeFile(filename + ".lock", JSON.stringify({ pid: exited.pid, token: crypto.randomUUID() }));
  const release = await lockMeasurements(filename); await release();
});

it("preserves records across temporary browser profiles and records the actual comparison condition", async () => {
  const { filename, store } = await storage();
  await complete(store, 7, metrics());
  const assisted = (await storage("silver-guide", filename)).store;
  const run = await complete(assisted, 7, metrics({ totalMs: 50_000, pdfMs: 20_000, sourceMs: 12, prepareMs: 250, outputMs: 140 }));
  expect(run).toMatchObject({ participant: 7, condition: "silver-guide", attempt: 1, status: "completed", platform: "test", buildId: "a".repeat(64) });
  const restored = (await storage("manual", filename)).store;
  expect(await restored.all()).toHaveLength(2);
  expect((await restored.apply({ action: "start", participant: 7 })).attempt).toBe(2);
  const saved = await readFile(filename, "utf8");
  expect(saved).not.toContain("fileName"); expect(saved).not.toContain("answers"); expect(saved).not.toContain("application/pdf");
});

it("rejects input content, malformed durations and automatic timings attributed to manual work", async () => {
  const { store } = await storage(), run = await store.apply({ action: "start", participant: 1 });
  await expect(store.apply({ action: "start", participant: "氏名" })).rejects.toThrow("形式");
  await expect(store.apply({ action: "start", participant: 1, name: "private" })).rejects.toThrow("形式");
  for (const invalid of [metrics({ totalMs: -1 }), metrics({ totalMs: Infinity }), metrics({ pdfMs: 100_000 }), metrics({ totalMs: 86_400_001 }), metrics({ pdfAttached: false }), metrics({ answers: "private" }), metrics({ prepareMs: 12 })])
    await expect(store.apply({ action: "finish", runId: run.id, measurements: invalid })).rejects.toThrow();
  expect((await store.all())[0].status).toBe("running");
});

it("serialises concurrent records and treats retries as one completion", async () => {
  const { store } = await storage();
  const runs = await Promise.all(Array.from({ length: 4 }, () => store.apply({ action: "start", participant: 1 })));
  expect(runs.map(run => run.attempt)).toEqual([1, 2, 3, 4]);
  const body = { action: "finish", runId: runs[0].id, measurements: metrics() };
  const result = await store.apply(body);
  expect(await store.apply({ ...body, measurements: metrics({ totalMs: 80_000 }) })).toEqual(result);
  expect(await store.all()).toHaveLength(4);
});

it("retains interrupted trials without turning them into completed measurements", async () => {
  const { store, filename } = await storage();
  await store.apply({ action: "start", participant: 1 });
  const restored = (await storage("silver-guide", filename)).store;
  expect((await restored.all())[0]).toMatchObject({ status: "interrupted", measurements: null });
  expect(summarize(await restored.all())).toMatchObject({ comparable: 0, unfinished: 1, pairs: 0 });
});

it("calculates paired differences per participant and OS, with missing, failed and unmatched trials excluded", () => {
  const run = (participant, condition, total, pdf, overrides = {}) => ({ id: crypto.randomUUID(), participant, condition, platform: "test", attempt: 1, status: "completed", measurements: metrics({ totalMs: total, pdfMs: pdf }), ...overrides });
  const runs = [run(1, "manual", 100_000, 80_000), run(1, "silver-guide", 40_000, 20_000),
    run(2, "manual", 200_000, 120_000), run(2, "silver-guide", 180_000, 100_000),
    run(1, "manual", 900_000, 800_000, { attempt: 2 }), // An unmatched repetition must not become an extra pair.
    run(3, "silver-guide", 20_000, null), run(4, "manual", 1, 1, { status: "cancelled" }),
    run(5, "manual", 1000, 500, { platform: "win32" }), run(5, "silver-guide", 1000, 500, { platform: "darwin" })];
  const result = summarize(runs);
  expect(result).toMatchObject({ pairs: 2, participants: 2, totalSaved: 40_000, pdfSaved: 40_000, totalPercent: 35, comparable: 7, excluded: 1, unfinished: 1 });
  expect(result.pdfPercent).toBeCloseTo((75 + 100 / 6) / 2);
  expect(result.groups.find(group => group.condition === "silver-guide")).toMatchObject({ count: 3, totalMedian: 40_000 });
  expect(summarize([]).totalSaved).toBeNull();
  expect(summarize([run(1, "manual", 50_000, 20_000), run(1, "silver-guide", 80_000, 40_000)]))
    .toMatchObject({ totalSaved: -30_000, totalPercent: -60, pdfSaved: -20_000, pdfPercent: -100 });
  expect(summarize([run(1, "manual", 0, 0), run(1, "silver-guide", 1000, 500)]))
    .toMatchObject({ totalPercent: null, pdfPercent: null });
});

it("exports seconds with empty manual processing durations, rather than invented zeroes", async () => {
  const { store } = await storage();
  const run = await complete(store, 1, metrics());
  const csv = resultsCsv([run]);
  expect(csv).toContain('"90.000","60.000","true","","",""');
  expect(csv).toContain('"build_id"'); expect(csv.startsWith("\ufeff")).toBe(true);
});

it("only accepts bounded, same-origin measurement writes and serves the persisted CSV locally", async () => {
  const { filename } = await storage();
  const server = await listenDemoServer(0, { measurement: { filename, condition: "manual" } });
  cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(origin + "/api/measurement", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  expect((await post({ action: "start", participant: 1 }, { Origin: "https://elsewhere.example" })).status).toBe(403);
  expect((await post({ action: "start", participant: 1 }, { Origin: "" })).status).toBe(403);
  expect((await post("x".repeat(3000))).status).toBe(413);
  expect((await post("not JSON")).status).toBe(400);
  expect((await post({ action: "start", participant: 1, pdf: "private" })).status).toBe(400);
  const { run } = await (await post({ action: "start", participant: 1 })).json();
  expect((await post({ action: "finish", runId: run.id, measurements: metrics() })).status).toBe(200);
  const csv = await fetch(origin + "/api/measurement/results.csv");
  expect(csv.headers.get("content-disposition")).toContain("silver-guide-results.csv");
  expect(await csv.text()).toContain('"90.000","60.000"');
  expect((await fetch(origin + "/", { method: "POST" })).status).toBe(405);
  expect((await fetch(origin + "/api/measurement/results", { headers: { Origin: "https://elsewhere.example" } })).status).toBe(403);
});
