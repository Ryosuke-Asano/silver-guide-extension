import { expect, it } from "vitest";
import { detectPlatform, parseRecords, recordsFile } from "../../demo/local-measurement.js";

const run = { id: "82e239a5-4270-4fdb-b373-f868cf1ec156", participant: 1, condition: "manual", attempt: 1, status: "completed",
  startedAt: "2026-10-31T01:00:00.000Z", endedAt: "2026-10-31T01:00:03.000Z", platform: "chromeos", buildId: "",
  measurements: { totalMs: 3000, pdfMs: 2000, pdfAttached: true, validationFailures: 0, pdfOpens: 1, sourceMs: null, prepareMs: null, outputMs: null } };
it("imports only bounded timing records and rejects answers, malformed times and duplicate IDs", () => {
  expect(parseRecords(recordsFile([run]))).toEqual([run]);
  for (const invalid of [
    { ...run, name: "private answer" }, { ...run, measurements: { ...run.measurements, answers: "private" } },
    { ...run, measurements: { ...run.measurements, pdfMs: 4000 } }, { ...run, measurements: { ...run.measurements, prepareMs: 1 } },
    { ...run, buildId: "=spreadsheet formula" }, { ...run, participant: 0 }, { ...run, platform: "private device name" },
    { ...run, startedAt: "unknown" }, { ...run, status: "running" }
  ]) expect(() => parseRecords(recordsFile([invalid]))).toThrow();
  expect(() => parseRecords(recordsFile([run, run]))).toThrow();
  expect(() => parseRecords({ ...recordsFile([run]), private: "answer" })).toThrow();
});
it("classifies ChromeOS separately and stores no user-agent string", () => {
  expect(detectPlatform("Mozilla/5.0 (X11; CrOS x86_64 15662.0.0) Chrome/130")).toBe("chromeos");
  expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("darwin");
  expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win32");
  expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
});
