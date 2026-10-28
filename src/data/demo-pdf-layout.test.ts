import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeManualPdfField, quadToBox, type PdfAnalysis } from "../domain/pdf";
import { applyDemoPdfLayout, LIBRARY_DEMO_LAYOUT } from "./demo-pdf-layout";

function analysis(): PdfAnalysis {
  const allowed = { allowed: true, reason: null };
  return { document: {
    id: "demo", hash: LIBRARY_DEMO_LAYOUT.hash, name: "renamed.pdf", byteLength: 1, pageCount: 1,
    pages: [{ index: 0, label: "1", mediaBox: [0, 0, 420, 595], cropBox: [0, 0, 420, 595], visibleBox: [0, 0, 420, 595], rotation: 0, userUnit: 1, widthPt: 420, heightPt: 595, extraction: "native", review: "unseen" }],
    capabilities: { read: allowed, analyze: allowed, nativeWrite: allowed, overlayWrite: allowed, export: allowed }, issues: [], actionDependent: false,
  }, fields: [], evidence: [], issues: [], complete: true };
}

describe("authored demo PDF positions", () => {
  it("matches the unchanged bundled original and every documented entry position", () => {
    const original = readFileSync(new URL("../../demo/assets/library-application-original.pdf", import.meta.url));
    expect(createHash("sha256").update(original).digest("hex")).toBe(LIBRARY_DEMO_LAYOUT.hash);
    const source = JSON.parse(readFileSync(new URL("../../demo/assets/library-application-source.json", import.meta.url), "utf8"));
    const before = analysis(), result = applyDemoPdfLayout(before);
    expect(result.document).toBe(before.document);
    expect(result.evidence).toBe(before.evidence);
    expect(before.fields).toEqual([]);
    expect(result.fields).toHaveLength(LIBRARY_DEMO_LAYOUT.fieldCount);
    const [procedure, ...textFields] = result.fields;
    expect(procedure.label).toBe("手続の内容");
    expect(procedure.kind).toBe("select"); expect(procedure.multiple).toBe(true);
    expect(textFields[0].label).toBe("氏名（姓）");
    const documentedChoices = source.extension_overlay.additional_fields[0].options;
    expect(procedure.options).toHaveLength(6);
    for (const option of procedure.options) {
      const documented = documentedChoices.find((item: { id: string }) => item.id === option.id);
      expect(option.label).toBe(documented.label);
      const actual = quadToBox(option.placements[0].quad);
      [documented.x, documented.y, documented.x + documented.w, documented.y + documented.h].forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
    }
    for (const field of textFields) {
      const documented = source.controlled_fixture.fields.find((item: { name: string }) => field.id === `library-demo-${item.name}`);
      expect(documented).toBeDefined();
      expect(quadToBox(field.placements[0].quad)).toEqual([documented.x, documented.y, documented.x + documented.w, documented.y + documented.h]);
      expect(field.required).toBe("unknown");
      expect(field.source).toBe("manual");
    }
  });
  it("retains ordinary detection for other bytes, incomplete analysis, native fields and restricted documents", () => {
    const other = analysis(); other.document.hash = "b".repeat(64);
    const incomplete = analysis(); incomplete.complete = false;
    const restricted = analysis(); restricted.document.capabilities.export = { allowed: false, reason: "原本の制限" };
    const native = analysis(); native.fields = [{ ...makeManualPdfField(0, [10, 10, 20, 20]), native: {} as NonNullable<ReturnType<typeof makeManualPdfField>["native"]> }];
    for (const value of [other, incomplete, restricted, native]) expect(applyDemoPdfLayout(value)).toBe(value);
  });
});
