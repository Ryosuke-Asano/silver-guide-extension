import { makeManualPdfField, type PdfAnalysis, type PdfField } from "../domain/pdf";

// Authored entry positions for the exact, unchanged PDF bundled with the demo.
// Coordinates and provenance: demo/assets/library-application-source.json.
// This is a partial demo layout, not an automatic recognition accuracy result.
export const LIBRARY_DEMO_LAYOUT = {
  hash: "cd6ad4a7291340abcc8c70b94c191367ce1b9fa4c01a604889c5c9a4d6b01ff7",
  title: "横浜市立図書館利用申込書",
  sourceUrl: "https://www.city.yokohama.lg.jp/kurashi/kyodo-manabi/library/guide/toroku/riyo-touroku.files/0007_20240126.pdf",
  fieldCount: 14,
} as const;

const procedures: readonly { id: string; label: string; box: [number, number, number, number] }[] = [
  { id: "new-registration", label: "新規登録", box: [77.64, 514.33, 87.24, 523.93] },
  { id: "change-registration", label: "登録内容変更", box: [131.16, 514.33, 140.76, 523.93] },
  { id: "renew-registration", label: "登録更新", box: [204.12, 514.33, 213.72, 523.93] },
  { id: "lost-card", label: "紛失", box: [257.64, 514.33, 267.24, 523.93] },
  { id: "temporary-loan", label: "臨時貸出", box: [291.72, 514.33, 301.32, 523.93] },
  { id: "other", label: "その他", box: [345.24, 514.33, 354.84, 523.93] },
];

type Entry = { id: string; label: string; box: [number, number, number, number]; hint: string; multiline?: boolean; max?: number; center?: boolean };
const entries: readonly Entry[] = [
  { id: "family_name", label: "氏名（姓）", box: [64, 440, 153, 460], hint: "名字を入力します。例：桜木" },
  { id: "given_name", label: "氏名（名）", box: [158, 440, 247, 460], hint: "下の名前を入力します。例：町子" },
  { id: "family_name_kana", label: "フリガナ（姓）", box: [64, 473.5, 153, 484.5], hint: "名字の読み方を入力します。例：サクラギ" },
  { id: "given_name_kana", label: "フリガナ（名）", box: [158, 473.5, 247, 484.5], hint: "下の名前の読み方を入力します。例：マチコ" },
  { id: "postal_code_prefix", label: "郵便番号（前3桁）", box: [77, 401, 99, 413], hint: "郵便番号の前3桁を入力します。例：220", max: 3 },
  { id: "postal_code_suffix", label: "郵便番号（後4桁）", box: [110, 401, 140, 413], hint: "郵便番号の後4桁を入力します。例：0032", max: 4 },
  { id: "address", label: "住所", box: [65, 368, 380, 397], hint: "番地・マンション名・部屋番号まで入力します。", multiline: true },
  { id: "home_phone_area", label: "自宅電話（市外局番）", box: [112, 337, 145, 350], hint: "自宅電話の最初の番号を入力します。自宅電話がなければ空欄で進めます。", max: 5, center: true },
  { id: "home_phone_local", label: "自宅電話（市内局番）", box: [157, 337, 192, 350], hint: "自宅電話の中央の番号を入力します。自宅電話がなければ空欄で進めます。", max: 4, center: true },
  { id: "home_phone_number", label: "自宅電話（加入者番号）", box: [205, 337, 266, 350], hint: "自宅電話の最後の番号を入力します。自宅電話がなければ空欄で進めます。", max: 4, center: true },
  { id: "mobile_phone_prefix", label: "携帯電話（前3桁）", box: [112, 314, 145, 327], hint: "携帯電話の前3桁を入力します。", max: 3, center: true },
  { id: "mobile_phone_middle", label: "携帯電話（中4桁）", box: [157, 314, 192, 327], hint: "携帯電話の中央4桁を入力します。", max: 4, center: true },
  { id: "mobile_phone_suffix", label: "携帯電話（後4桁）", box: [205, 314, 266, 327], hint: "携帯電話の最後の4桁を入力します。", max: 4, center: true },
];

export function applyDemoPdfLayout(analysis: PdfAnalysis): PdfAnalysis {
  if (analysis.document.hash !== LIBRARY_DEMO_LAYOUT.hash || analysis.document.pageCount !== 1
    || !analysis.complete || !analysis.document.capabilities.export.allowed || analysis.fields.some(field => field.native)) return analysis;
  const fields: PdfField[] = entries.map(entry => ({
    ...makeManualPdfField(0, entry.box, entry.label, entry.multiline ? "multiline" : "text"),
    id: `library-demo-${entry.id}`, description: entry.hint, role: "applicant",
    // The demo's required flags and arbitrary text limits are not official rules.
    ...(entry.max ? { maxGraphemes: entry.max } : {}),
    ...(entry.center ? { style: { alignment: "center" as const } } : {}),
  }));
  const options = procedures.map(option => ({
    id: option.id, label: option.label, exportValue: option.id,
    placements: makeManualPdfField(0, option.box).placements,
  }));
  const procedure: PdfField = {
    ...makeManualPdfField(0, procedures[0].box, "手続の内容", "select"),
    id: "library-demo-procedure", role: "applicant", multiple: true,
    description: "当てはまる項目にチェックを入れます。PDF上の枠でも選べます。",
    options, placements: options.flatMap(option => option.placements),
  };
  return { ...analysis, fields: [procedure, ...fields] };
}
