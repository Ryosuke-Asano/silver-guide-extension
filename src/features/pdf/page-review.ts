import {
  pdfFieldReadOnly,
  type PdfAnalysis, type PdfEvidence, type PdfField, type PdfPageInfo, type PdfPlacement, type PdfQuad
} from "../../domain/pdf";

export type PdfPageReviewHint = {
  kind: "instructions-heading" | "example-heading" | "dense-table";
  message: string;
  /** Original extracted fragments, never a publisher-purpose or probability claim. */
  evidenceIds: string[];
  sourceExcerpt: string | null;
};
export type PdfPageReviewTableFacts = {
  numericOrMarkLabelCount: number;
  gridCellCount: number;
  gridRowCount: number;
  gridColumnCount: number;
  alignedRowCount: number;
  alignedColumnCount: number;
};
export type PdfPageReviewSummary = {
  pageIndex: number;
  /** A question belongs to every page in its direct or option placements, counted once per page. */
  candidateCount: number;
  activeCount: number;
  /** Active questions with an unresolved mapping, role, required designation or condition. */
  unknownCount: number;
  rejectedCount: number;
  sharedFieldCount: number;
  sharedFieldIds: string[];
  sharedFields: Array<{ fieldId: string; pageIndices: number[] }>;
  table: PdfPageReviewTableFacts;
  hints: PdfPageReviewHint[];
};

const MAX_HINT_EVIDENCE = 8, MAX_EXCERPT = 160;
const INSTRUCTIONS = /記載要領|記入要領|作成要領|記入方法|記載方法|記入上の注意|注意事項|説明書/u;
const EXAMPLE = /記入例|記載例|記入見本|記載見本/u;
type VisualBox = { left: number; top: number; right: number; bottom: number };
type PageField = { field: PdfField; placements: PdfPlacement[]; pageIndices: number[] };

/** PDF source coordinates remain unrotated; heading position follows the visible page rotation. */
function visualBox(quad: PdfQuad, page: PdfPageInfo): VisualBox | null {
  const [x0, y0, x1, y1] = page.visibleBox, width = x1 - x0, height = y1 - y0;
  if (!(width > 0 && height > 0)) return null;
  const points = quad.map(point => {
    const x = (point.x - x0) / width, y = (point.y - y0) / height;
    switch (page.rotation) {
      case 90: return { x: y, y: x };
      case 180: return { x: 1 - x, y };
      case 270: return { x: 1 - y, y: 1 - x };
      default: return { x, y: 1 - y };
    }
  });
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const box = { left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) };
  return box.right < 0 || box.left > 1 || box.bottom < 0 || box.top > 1 ? null : box;
}
function numericOrMark(text: string): boolean {
  const label = text.normalize("NFKC").replace(/\s/gu, "");
  return /^(?:[0-9]+(?:[./:－-][0-9]+)*|(?:No[.]?|№)[0-9]+|[□☐☑■✓✔○〇●◯―]+)$/iu.test(label);
}
function headingFragment(text: string): boolean {
  // A reference to examples within a sentence is not a heading, even at the top.
  // Conservative abstention leaves the raw text and all candidate fields available.
  return !/[。！？!?]|ください|下さい|(?:を|に)(?:参照|確認|記入|記載|入力)(?:して|します|する)|(?:です|ます)\s*$/u.test(text);
}
function unknown(field: PdfField): boolean {
  return !["confirmed", "manual"].includes(field.mappingState) || field.role === "unknown"
    || field.required === "unknown" || field.conditionStatus === "unknown" || field.templateBinding?.review.state === "needs-review";
}
function hint(kind: PdfPageReviewHint["kind"], message: string, evidence: readonly PdfEvidence[]): PdfPageReviewHint {
  const fragments = evidence.slice(0, MAX_HINT_EVIDENCE);
  let excerpt = fragments.map(item => item.text).join("\n").slice(0, MAX_EXCERPT);
  if (/[\uD800-\uDBFF]$/u.test(excerpt)) excerpt = excerpt.slice(0, -1);
  return { kind, message, evidenceIds: fragments.map(item => item.id),
    sourceExcerpt: fragments.length ? excerpt : null };
}

/**
 * Derived review facts only. No fields, answers, native restrictions, page purposes or review
 * states are changed. A dense real input/checklist table can produce the same hint as a lookup
 * table; only the person inspecting the original can decide to exclude it. No heading hint
 * propagates to following pages, and no calibrated confidence is invented.
 */
export function derivePdfPageReviewSummaries(
  analysis: Pick<PdfAnalysis, "document" | "fields" | "evidence">,
  fields: readonly PdfField[] = analysis.fields
): PdfPageReviewSummary[] {
  const buckets = new Map(analysis.document.pages.map(page => [page.index, new Map<string, PageField>()]));
  const text = new Map(analysis.document.pages.map(page => [page.index, [] as PdfEvidence[]]));
  for (const evidence of analysis.evidence) text.get(evidence.pageIndex)?.push(evidence);
  for (const field of fields) {
    const placements = [...field.placements, ...field.options.flatMap(option => option.placements)];
    const belonging = new Map<number, PdfPlacement[]>();
    for (const placement of placements) if (buckets.has(placement.pageIndex)) {
      const existing = belonging.get(placement.pageIndex);
      if (existing) existing.push(placement); else belonging.set(placement.pageIndex, [placement]);
    }
    const pageIndices = [...belonging.keys()].sort((a, b) => a - b);
    for (const [pageIndex, local] of belonging) buckets.get(pageIndex)!.set(field.id, { field, placements: local, pageIndices });
  }
  return analysis.document.pages.map(page => {
    const records = [...buckets.get(page.index)!.values()], evidence = text.get(page.index)!;
    const sharedFields = records.filter(record => record.pageIndices.length > 1)
      .map(record => ({ fieldId: record.field.id, pageIndices: [...record.pageIndices] }));
    const active = records.filter(record => record.field.mappingState !== "rejected" && !pdfFieldReadOnly(record.field));
    const numeric = records.filter(record => numericOrMark(record.field.label));
    const rows = new Map<number, Set<number>>(), columns = new Map<number, Set<number>>();
    for (const record of records) for (const placement of record.placements) {
      const box = visualBox(placement.quad, page); if (!box) continue;
      // Half-percent visual-page bins are observations of aligned centers, not table semantics.
      const row = Math.round((box.top + box.bottom) * 100), column = Math.round((box.left + box.right) * 100);
      if (!rows.has(row)) rows.set(row, new Set()); rows.get(row)!.add(column);
      if (!columns.has(column)) columns.set(column, new Set()); columns.get(column)!.add(row);
    }
    const table: PdfPageReviewTableFacts = {
      numericOrMarkLabelCount: numeric.length, gridCellCount: [...rows.values()].reduce((count, cells) => count + cells.size, 0),
      gridRowCount: rows.size, gridColumnCount: columns.size,
      alignedRowCount: [...rows.values()].filter(cells => cells.size >= 4).length,
      alignedColumnCount: [...columns.values()].filter(cells => cells.size >= 8).length
    };
    const instructions: PdfEvidence[] = [], examples: PdfEvidence[] = [];
    for (const item of evidence) {
      if (item.text.trim().length > 240 || item.method === "ocr" && (item.rawOcrConfidence ?? 0) < 35) continue;
      const normalized = item.text.normalize("NFKC"); if (!headingFragment(normalized)) continue;
      const isInstructions = INSTRUCTIONS.test(normalized), isExample = EXAMPLE.test(normalized);
      if (!isInstructions && !isExample) continue;
      const box = visualBox(item.quad, page);
      if (!box || (box.top + box.bottom) / 2 > .2 || box.bottom - box.top > .12) continue;
      if (isInstructions && instructions.length < MAX_HINT_EVIDENCE) instructions.push(item);
      if (isExample && examples.length < MAX_HINT_EVIDENCE) examples.push(item);
    }
    const hints: PdfPageReviewHint[] = [];
    if (instructions.length) hints.push(hint("instructions-heading", "説明のページの可能性があります。原本を見て、記入するページか確認してください。", instructions));
    if (examples.length) hints.push(hint("example-heading", "記入例のページの可能性があります。原本を見て、記入するページか確認してください。", examples));
    if (records.length >= 80 && numeric.length >= 40 && numeric.length / records.length >= .6
      && table.alignedRowCount >= 8 && table.alignedColumnCount >= 4) {
      const originalById = new Map(evidence.map(item => [item.id, item])), fragments: PdfEvidence[] = [], seen = new Set<string>();
      search: for (const record of numeric) for (const id of record.field.evidenceIds) {
        const original = originalById.get(id);
        if (!original || !original.text.trim() || seen.has(id)) continue;
        seen.add(id); fragments.push(original);
        if (fragments.length >= MAX_HINT_EVIDENCE) break search;
      }
      if (fragments.length) hints.push(hint("dense-table", "数字や選択印の候補が多く、行と列の並びがあります。参照表か記入用の表か、原本で確認してください。", fragments));
    }
    return { pageIndex: page.index, candidateCount: records.length, activeCount: active.length,
      unknownCount: active.filter(record => unknown(record.field)).length,
      rejectedCount: records.filter(record => record.field.mappingState === "rejected").length,
      sharedFieldCount: sharedFields.length, sharedFieldIds: sharedFields.map(shared => shared.fieldId), sharedFields, table, hints };
  });
}
