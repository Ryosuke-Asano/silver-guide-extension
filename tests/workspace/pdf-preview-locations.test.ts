import { describe, expect, it } from "vitest";
import { makeManualPdfField, type PdfField, type PdfPlacement } from "../../src/domain/pdf";
import { derivePdfPreviewLocations } from "../../src/apps/workspace/pdf-preview-locations";

function placement(pageIndex: number, widgetRef: string | null = null): PdfPlacement {
  return { ...makeManualPdfField(pageIndex, [60, 520, 80, 540]).placements[0], widgetRef };
}
function field(id: string, placements: PdfPlacement[], label = "同じ項目名"): PdfField {
  return { ...makeManualPdfField(0, [60, 520, 80, 540], label), id, placements };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("complete original-page location projection", () => {
  it("unions exact direct/option shapes but retains every logical origin and option label", () => {
    const first = placement(0, "12 0 R"), second = placement(1, "13 0 R"), optionOnly = placement(2, "14 0 R");
    const choice = field("choice", [first, second, structuredClone(first)]);
    choice.options = [
      { id: "post", label: "郵送", exportValue: "POST", placements: [structuredClone(first), structuredClone(second)] },
      { id: "counter", label: "窓口", exportValue: "COUNTER", placements: [optionOnly, structuredClone(optionOnly)] }
    ];
    const locations = derivePdfPreviewLocations([choice]);
    expect([...locations.keys()]).toEqual([0, 1, 2]);
    expect([...locations.values()].map(page => page.length)).toEqual([1, 1, 1]);
    expect(locations.get(0)![0].aliases).toEqual([
      { kind: "direct", placementIndex: 0 }, { kind: "direct", placementIndex: 2 },
      { kind: "option", optionId: "post", optionIndex: 0, placementIndex: 0, label: "郵送" }
    ]);
    expect(locations.get(1)![0].aliases).toEqual([
      { kind: "direct", placementIndex: 1 },
      { kind: "option", optionId: "post", optionIndex: 0, placementIndex: 1, label: "郵送" }
    ]);
    expect(locations.get(2)![0].aliases).toEqual([
      { kind: "option", optionId: "counter", optionIndex: 1, placementIndex: 0, label: "窓口" },
      { kind: "option", optionId: "counter", optionIndex: 1, placementIndex: 1, label: "窓口" }
    ]);
    expect([...locations.values()].flatMap(page => page.flatMap(location => location.aliases))).toHaveLength(7);
    expect([...locations.values()].map(page => page[0].optionLabels)).toEqual([["郵送"], ["郵送"], ["窓口"]]);
  });

  it("keeps coincident same-name fields, different widgets, different pages and exact nearby coordinates distinct", () => {
    const near = placement(0, "10 0 R");
    near.quad[0].x += 0.00001;
    const first = field("first", [placement(0, "10 0 R"), placement(0, "11 0 R"), placement(0), near, placement(1, "10 0 R")]);
    const second = field("second", [placement(0, "10 0 R")]);
    const pages = derivePdfPreviewLocations([first, second]);
    expect(pages.get(0)).toHaveLength(5);
    expect(pages.get(0)!.map(location => location.field.id)).toEqual(["first", "first", "first", "first", "second"]);
    expect(pages.get(0)!.map(location => location.number)).toEqual([1, 2, 3, 4, 5]);
    expect(pages.get(0)!.map(location => location.fieldNumber)).toEqual([1, 1, 1, 1, 2]);
    expect(pages.get(1)!.map(location => [location.number, location.fieldNumber])).toEqual([[1, 1]]);
    expect(new Set([...pages.values()].flat().map(location => location.key)).size).toBe(6);
  });

  it("includes option-only, rejected and read-only locations without changing their flags or merging option identities", () => {
    const optionOnly = field("option-only", []);
    optionOnly.mappingState = "rejected";
    optionOnly.readOnly = true;
    optionOnly.options = [
      { id: "first-choice", label: "同じ選択肢名", exportValue: "A", placements: [placement(2)] },
      { id: "second-choice", label: "同じ選択肢名", exportValue: "B", placements: [placement(2)] },
      { id: "third-choice", label: "別の選択肢名", exportValue: "C", placements: [placement(2)] }
    ];
    const locations = derivePdfPreviewLocations([optionOnly]).get(2)!;
    expect(locations).toHaveLength(1);
    expect(locations[0].aliases.filter(alias => alias.kind === "option").map(alias => alias.optionId)).toEqual(["first-choice", "second-choice", "third-choice"]);
    expect(locations[0].optionLabels).toEqual(["同じ選択肢名", "別の選択肢名"]);
    expect(locations[0].field).toBe(optionOnly);
    expect(locations[0].field).toMatchObject({ mappingState: "rejected", readOnly: true, placements: [] });
  });

  it("numbers each page in source encounter order and keeps physical keys stable across metadata changes or source reordering", () => {
    const first = field("first", [placement(2), placement(0)]), second = field("second", [placement(0)]), third = field("third", [placement(2)]);
    const before = derivePdfPreviewLocations([first, second, third]);
    expect([...before.keys()]).toEqual([2, 0]);
    expect(before.get(2)!.map(location => [location.number, location.fieldNumber])).toEqual([[1, 1], [2, 3]]);
    expect(before.get(0)!.map(location => [location.number, location.fieldNumber])).toEqual([[1, 1], [2, 2]]);
    const changed = { ...structuredClone(first), revision: 20, label: "修正した項目名", description: "説明を確認した", mappingState: "rejected" as const };
    const after = derivePdfPreviewLocations([third, second, changed]);
    const keyByFieldAndPage = (pages: ReturnType<typeof derivePdfPreviewLocations>) => [...pages.values()].flat().map(location => [location.field.id, location.placement.pageIndex, location.key]).sort();
    expect(keyByFieldAndPage(after)).toEqual(keyByFieldAndPage(before));
    expect(after.get(2)!.map(location => [location.number, location.fieldNumber])).toEqual([[1, 1], [2, 3]]);
  });

  it("reads frozen source data without mutating geometry, cells, writing mode, native constraints or initial answers", () => {
    const originalPlacement = placement(0, "12 0 R");
    originalPlacement.cells = [structuredClone(originalPlacement.quad)];
    originalPlacement.writingMode = "vertical";
    const original = field("source", [originalPlacement]);
    original.initialValue = "元PDFの値";
    original.native = { name: "source", fieldRef: "11 0 R", referenceKind: "field", widgetRefs: ["12 0 R"], maxLength: 64, lengthUnit: "utf16-code-unit", multiSelect: false, editableSelect: false, originalRequired: true, originalReadOnly: true, unsupported: false };
    original.options = [{ id: "retained-option", label: "残す選択肢", exportValue: "VALUE", placements: [structuredClone(originalPlacement)] }];
    const before = structuredClone(original), inputs = freeze([original]);
    const locations = derivePdfPreviewLocations(inputs).get(0)!;
    expect(original).toEqual(before);
    expect(locations[0].field).toBe(original);
    expect(locations[0].placement).toBe(originalPlacement);
    expect(locations[0].aliases).toHaveLength(2);
    locations[0].aliases.push({ kind: "direct", placementIndex: 100 });
    locations[0].optionLabels.push("表示側だけの文字");
    expect(original).toEqual(before);
    expect(derivePdfPreviewLocations(inputs).get(0)![0].aliases).toHaveLength(2);
  });
});
