// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initializeMeasurement } from "../../demo/measurement.js";

const fixture = '<details id="measurement" hidden><input id="measurement-participant" type="number" value="1" required><button id="measurement-start">開始</button><button id="measurement-stop">中止</button><button id="measurement-retry">再試行</button><p id="measurement-status"></p><output id="measurement-elapsed"></output><span id="measurement-condition"></span></details><a id="measurement-results-link" hidden></a><input id="private" value="private answer"><span data-silver-guide-pdf-entry></span>';
const originalFetch = window.fetch;
afterEach(() => { window.dispatchEvent(new Event("pagehide")); window.fetch = originalFetch; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ""; document.documentElement.removeAttribute("data-silver-guide-measure"); });
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
async function setup({ failure = false } = {}) {
  vi.useFakeTimers(); document.body.innerHTML = fixture;
  let clock = 0, fail = failure;
  vi.spyOn(window.performance, "now").mockImplementation(() => clock);
  const writes = [];
  window.fetch = vi.fn(async (url, options) => {
    if (url.endsWith("/config")) return { json: async () => ({ enabled: true, condition: "silver-guide" }) };
    const body = JSON.parse(options.body); writes.push(body);
    if (body.action === "start") return { ok: true, json: async () => ({ run: { id: "test-run", participant: 1 } }) };
    if (fail) { fail = false; throw new Error("test storage failure"); }
    return { ok: true, json: async () => ({ run: { status: body.action === "finish" ? "completed" : "cancelled", measurements: body.measurements } }) };
  });
  const reset = vi.fn(), controller = initializeMeasurement(document, reset);
  await settle();
  return { controller, reset, writes, advance: value => { clock = value; } };
}

it("records the full PDF workflow through a shadow button without reading input content", async () => {
  const { controller, reset, writes, advance } = await setup();
  const read = vi.fn(() => { throw new Error("Private input read"); });
  Object.defineProperty(document.getElementById("private"), "value", { get: read });
  document.getElementById("measurement-start").click(); await settle();
  expect(reset).toHaveBeenCalledOnce();
  expect(document.documentElement.hasAttribute("data-silver-guide-measure")).toBe(true);
  const host = document.querySelector("[data-silver-guide-pdf-entry]"), button = document.createElement("button");
  host.attachShadow({ mode: "open" }).append(button);
  button.addEventListener("click", event => event.stopPropagation());
  advance(500); button.click();
  document.dispatchEvent(new CustomEvent("silver-guide-pdf-timing", { detail: JSON.stringify({ id: "pdf-one", sourceMs: 10, prepareMs: 100, outputMs: 50, private: "ignored" }) }));
  // The same cumulative handoff report must never be double-counted.
  document.dispatchEvent(new CustomEvent("silver-guide-pdf-timing", { detail: JSON.stringify({ id: "pdf-one", sourceMs: 10, prepareMs: 100, outputMs: 50 }) }));
  advance(1000); controller.attached(); controller.validationFailure();
  advance(3000); controller.complete(); await settle();
  expect(writes.at(-1)).toMatchObject({ action: "finish", measurements: { totalMs: 3000, pdfMs: 500, pdfAttached: true, pdfOpens: 1, validationFailures: 1, sourceMs: 10, prepareMs: 100, outputMs: 50 } });
  expect(read).not.toHaveBeenCalled(); expect(JSON.stringify(writes)).not.toContain("private");
});

it("freezes the measured endpoint across a failed save and a later retry", async () => {
  const { controller, writes, advance } = await setup({ failure: true });
  document.getElementById("measurement-start").click(); await settle();
  advance(2000); controller.complete(); await settle();
  expect(document.getElementById("measurement-status").textContent).toContain("保存を再試行");
  expect(document.getElementById("measurement-start").disabled).toBe(true);
  advance(20_000); document.getElementById("measurement-retry").click(); await settle();
  expect(writes.at(-1).measurements.totalMs).toBe(2000);
  expect(document.getElementById("measurement-status").textContent).toContain("記録しました");
  expect(document.getElementById("measurement-start").disabled).toBe(false);
});

it("records reset as cancellation and does not reuse the attachment from a previous round", async () => {
  const { controller, writes, advance } = await setup();
  document.getElementById("measurement-start").click(); await settle();
  advance(100); controller.attached();
  advance(300); controller.reset(); await settle();
  expect(writes.at(-1)).toMatchObject({ action: "cancel", measurements: { totalMs: 300, pdfAttached: true, pdfMs: null } });
  document.getElementById("measurement-start").click(); await settle();
  advance(600); controller.complete(); await settle();
  expect(writes.at(-1)).toMatchObject({ action: "finish", measurements: { totalMs: 300, pdfAttached: false, pdfMs: null } });
});
