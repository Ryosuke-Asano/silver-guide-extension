/** Portable PDF contracts. Coordinates are unrotated PDF user space, bottom-left origin. */
export const PDF_MAX_INPUT_BYTES = 100 * 1024 * 1024;
/** Includes bounded font/appearance growth; accessible only through a validated export's session. */
export const PDF_MAX_OUTPUT_BYTES = 160 * 1024 * 1024;
export type PdfPoint = { x: number; y: number };
export type PdfQuad = [PdfPoint, PdfPoint, PdfPoint, PdfPoint];
export type PdfBox = [number, number, number, number];
export type PdfAffine = [number, number, number, number, number, number];
export type PdfFieldKind = "text" | "multiline" | "date" | "number" | "checkbox" | "radio" | "select" | "signature" | "unknown";
export type PdfRole = "applicant" | "proxy" | "organization" | "office" | "signature" | "unknown";
export type PdfAnswer = string | boolean | string[] | null;
export type PdfAnswers = Record<string, PdfAnswer>;
export type PdfRuleAst = { op: "eq"; fieldId: string; value: string | boolean } | { op: "present"; fieldId: string } | { op: "all" | "any"; args: PdfRuleAst[] } | { op: "not"; arg: PdfRuleAst };
export type PdfTruth = true | false | "unknown";
export type PdfIssue = { code: string; message: string; pageIndex?: number; fieldId?: string; severity: "info" | "warning" | "error" };
export type PdfCapability = { allowed: boolean; reason: string | null };
export type PdfCapabilities = Record<"read" | "analyze" | "nativeWrite" | "overlayWrite" | "export", PdfCapability>;
export type PdfPlacement = { pageIndex: number; quad: PdfQuad; widgetRef: string | null; cells?: PdfQuad[]; writingMode: "horizontal" | "vertical" };
export type PdfOption = { id: string; label: string; exportValue: string | null; placements: PdfPlacement[] };
export type PdfTemplateReviewReason = "expired" | "revoked" | "untrusted" | "changed" | "unavailable" | "verification-failed";
/** Immutable adoption provenance; manual source review never upgrades its signed origin. */
export type PdfTemplateBinding = {
  schemaVersion: 1; templateId: string; templateVersion: string; templateFieldId: string;
  match: "exact" | "layout-candidate"; originalHash: string; layoutFingerprint: string | null;
  descriptorHash: string; fieldSemanticHash: string; adoptedAt: string;
  source: { keyId: string; packageId: string; release: number; payloadHash: string; sourceURL: string; reviewedAt: string; validUntil: string; packageValidUntil: string };
  review: { state: "current" | "needs-review" | "manual-confirmed"; reason: PdfTemplateReviewReason | null; invalidationKey: string | null; confirmedAt?: string };
};
export type PdfField = {
  id: string; revision: number; source: "acroform" | "inferred" | "manual";
  kind: PdfFieldKind; label: string; labelOriginal: string; description: string;
  role: PdfRole; subjectId: string | null; required: boolean | "unknown";
  subjectLabel?: string;
  requiredEvidenceIds: string[];
  requiredSource?: { kind: "native" | "document" | "manual"; text: string; pageIndex?: number };
  conditionStatus: "unconditional" | "confirmed" | "unknown";
  condition: PdfRuleAst | null;
  conditionSource?: { text: string; pageIndex: number };
  native: { name: string; fieldRef: string; referenceKind?:"field"|"read-only-widget"; widgetRefs: string[]; maxLength: number | null; lengthUnit: "utf16-code-unit"; multiSelect: boolean; editableSelect: boolean; originalRequired?:boolean; originalReadOnly?:boolean; unsupported?:boolean } | null;
  placements: PdfPlacement[]; options: PdfOption[];
  initialValue: PdfAnswer; maxGraphemes: number | null;
  readOnly: boolean; mappingState: "proposed" | "needs-review" | "confirmed" | "rejected" | "manual";
  evidenceIds: string[];
  templateBinding?: PdfTemplateBinding;
  confidence: { text: number | null; geometry: number | null; labelMapping: number | null; calibrationVersion: string | null };
  style?: { fontSizePt?: number; allowSmallFont?: boolean; alignment?: "left" | "center" | "right" };
};
export type PdfEvidence = { id: string; pageIndex: number; text: string; quad: PdfQuad; method: "native" | "ocr"; rawOcrConfidence: number | null };
export type PdfPageInfo = {
  index: number; label: string; mediaBox: PdfBox | null; cropBox: PdfBox | null;
  visibleBox: PdfBox; rotation: 0 | 90 | 180 | 270; userUnit: number;
  widthPt: number; heightPt: number;
  extraction: "native" | "image" | "mixed" | "unusable";
  review: "unseen" | "inputs-confirmed" | "no-inputs-confirmed" | "excluded";
};
export type PdfDocumentInfo = { id: string; hash: string; name: string; byteLength: number; pageCount: number; pages: PdfPageInfo[]; capabilities: PdfCapabilities; issues: PdfIssue[]; actionDependent: boolean };
export type PdfAnalysis = { document: PdfDocumentInfo; fields: PdfField[]; evidence: PdfEvidence[]; issues: PdfIssue[]; complete: boolean };
export type PdfProgress = { stage: "loading" | "text" | "ocr" | "structure" | "export" | "validation"; pageIndex?: number; completed: number; total: number; detail?: string };
export type PdfAssetPaths = { worker: string; cMaps: string; standardFonts: string; wasm: string; ocrWorker: string; ocrCore: string; ocrLanguages: string; japaneseFont: string };
export type PdfOpenOptions = { name?: string; password?: string; onPassword?: (reason: "required" | "incorrect") => Promise<string | null>; signal?: AbortSignal; onProgress?: (progress: PdfProgress) => void; assets?: Partial<PdfAssetPaths> };
export type PdfAnalyzeOptions = { signal?: AbortSignal; onProgress?: (progress: PdfProgress) => void; ocr?: "auto" | "always" | "never"; pageIndices?: number[]; ocrTimeoutMs?: 90_000 | 180_000 };
export type PdfExportOptions = { inputMode?: "direct"; fields: PdfField[]; answers: PdfAnswers; answerStatus?: Record<string,string>; pageReviews?:Array<{pageIndex:number;review:PdfPageInfo["review"]}>; mode?: "editable-form" | "print" | "overlay"; fontBytes?: Uint8Array; signal?: AbortSignal; onProgress?: (progress: PdfProgress) => void; allowIncomplete?: boolean; actionRemovalConfirmed?: boolean };
export type PdfExportResult = { bytes: Uint8Array; hash: string; issues: PdfIssue[]; validated: boolean; mode: "editable-form" | "print" | "overlay"; originalHash: string; pageCount: number };
export type PdfNativeSourceConstraint = { name:string; fieldRef:string; referenceKind:"field"|"read-only-widget"; originalReadOnly:boolean; unsupported:boolean; initialValue:PdfAnswer };
export type PdfNativeConstraints = { documentHash:string; fields:PdfNativeSourceConstraint[] };

/** A native answer affects every widget, including option-specific placements. */
export function pdfFieldPageIndices(field:PdfField):number[]{
  return [...new Set([...field.placements,...field.options.flatMap(option=>option.placements)].map(place=>place.pageIndex))].sort((a,b)=>a-b);
}

/** Role edits cannot clear writer restrictions; legacy constraints require original hydration. */
export function pdfFieldSourceReadOnly(field:PdfField):boolean{
  const native=field.native;if(!native)return false;
  return native.referenceKind==="read-only-widget"||native.originalReadOnly!==false||native.unsupported!==false;
}
export function pdfFieldReadOnly(field:PdfField):boolean{
  return field.readOnly||pdfFieldSourceReadOnly(field)||field.role==="office"||field.role==="signature"||field.kind==="signature";
}

/** Cleared legacy values are compatible; retained answers are never silently coerced. */
export function pdfAnswerTypeCompatible(field: Pick<PdfField, "kind" | "native">, value: unknown): value is PdfAnswer | undefined {
  if (value === undefined || value === null || value === "") return true;
  if (field.kind === "checkbox") return typeof value === "boolean";
  if (field.kind === "select" && field.native?.multiSelect) {
    if (!Array.isArray(value)) return false;
    for (const item of value) if (typeof item !== "string") return false;
    return true;
  }
  return typeof value === "string";
}
export class PdfEngineError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: PdfIssue[] = []) { super(message); this.name = "PdfEngineError"; }
}

export function rectToQuad(box: PdfBox): PdfQuad {
  const [x0, y0, x1, y1] = box;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
export function quadToBox(quad: PdfQuad): PdfBox {
  return [Math.min(...quad.map(p => p.x)), Math.min(...quad.map(p => p.y)), Math.max(...quad.map(p => p.x)), Math.max(...quad.map(p => p.y))];
}
export function makeManualPdfField(pageIndex: number, box: PdfBox, label = "追加した項目", kind: PdfFieldKind = "text"): PdfField {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || box.some(v => !Number.isFinite(v)) || box[2] <= box[0] || box[3] <= box[1]) throw new PdfEngineError("INVALID_GEOMETRY", "記入場所の寸法が正しくありません。");
  return { id: crypto.randomUUID(), revision: 1, source: "manual", kind, label, labelOriginal: label, description: "本人が追加した項目です。", role: "unknown", subjectId: null, required: "unknown", requiredEvidenceIds: [], conditionStatus: "unconditional", condition: null, native: null, placements: [{ pageIndex, quad: rectToQuad(box), widgetRef: null, writingMode: "horizontal" }], options: [], initialValue: null, maxGraphemes: null, readOnly: kind === "signature", mappingState: "manual", evidenceIds: [], confidence: { text: null, geometry: null, labelMapping: null, calibrationVersion: null } };
}

export function evaluatePdfRule(rule: PdfRuleAst, answers: PdfAnswers, context: { answerStatus?:Record<string,string> } = {}): PdfTruth {
  let remaining=200;const evaluate=(node:PdfRuleAst,depth:number):PdfTruth=>{
    if(depth>16||--remaining<0)throw new PdfEngineError("CONDITION_LIMIT","項目の条件が複雑すぎます。");
    if(node.op==="eq"||node.op==="present"){const value=answers[node.fieldId];if(context.answerStatus&&context.answerStatus[node.fieldId]!=="entered"||value===undefined||value===null||value===""||Array.isArray(value)&&!value.length)return "unknown";return node.op==="present"?true:value===node.value;}
    if(node.op==="not"){const value=evaluate(node.arg,depth+1);return value==="unknown"?"unknown":!value;}
    if(!node.args.length)return "unknown";const values=node.args.map(arg=>evaluate(arg,depth+1));if(node.op==="all")return values.includes(false)?false:values.includes("unknown")?"unknown":true;return values.includes(true)?true:values.includes("unknown")?"unknown":false;
  };return evaluate(rule,0);
}
export function pdfFieldApplicability(field: PdfField, answers: PdfAnswers, context: { answerStatus?:Record<string,string> } = {}): PdfTruth {
  if (field.conditionStatus === "unknown") return "unknown";
  if (field.conditionStatus === "confirmed") return field.condition ? evaluatePdfRule(field.condition, answers, context) : "unknown";
  return true;
}

export type PdfFormatSuggestion = { id: string; label: string; value: string; explanation: string };
export function suggestPdfAnswerFormats(value: string, label = ""): PdfFormatSuggestion[] {
  const suggestions:PdfFormatSuggestion[]=[];const add=(id:string,title:string,next:string,explanation:string)=>{if(next!==value&&!suggestions.some(s=>s.value===next))suggestions.push({id,label:title,value:next,explanation});};
  const narrow=value.replace(/[０-９Ａ-Ｚａ-ｚ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0xFEE0));
  add("halfwidth","英数字を半角にする",narrow,"氏名や漢字は変更せず、全角の英数字だけを変換します。");
  const wide=value.replace(/[0-9A-Za-z]/g,char=>String.fromCharCode(char.charCodeAt(0)+0xFEE0));add("fullwidth","英数字を全角にする",wide,"原書類が全角を指定する場合に選びます。");
  if(/ふりがな|フリガナ|よみ|読み|カナ/.test(label)){
    add("hiragana","ひらがなにする",value.replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60)),"入力した読みを変換します。漢字から読みを推測しません。");
    add("katakana","カタカナにする",value.replace(/[ぁ-ゖ]/g,char=>String.fromCharCode(char.charCodeAt(0)+0x60)),"入力した読みを変換します。人名の読みを自動で確定しません。");
    add("kana-wide","半角カナを全角にする",value.replace(/[\uFF61-\uFF9F]+/g,run=>run.normalize("NFKC")),"半角カナの範囲だけを変換します。氏名の漢字は変えません。");
  }
  if(/住所|所在地|番地/.test(label))add("address-digits","住所の英数字を半角にする",narrow,"町名・番地・建物名を追加、省略、推測しません。");
  if(/郵便/.test(label)){const digits=narrow.replace(/[\s〒‐‑−ー-]/g,"");if(/^\d{7}$/.test(digits))add("postal","郵便番号にハイフンを入れる",`${digits.slice(0,3)}-${digits.slice(3)}`,"入力した7桁の数字を 3桁と4桁に分けます。住所の検索は行いません。");}
  if(/日|年月|生まれ|生年/.test(label)){const date=parseJapaneseDate(value);if(date){const year=date.getUTCFullYear(),month=date.getUTCMonth()+1,day=date.getUTCDate();add("date-western","西暦の年月日にする",`${year}年${month}月${day}日`,"年月日を確認してから適用してください。");add("date-slashes","数字と区切りで書く",`${year}/${String(month).padStart(2,"0")}/${String(day).padStart(2,"0")}`,"年月日の順で表示します。");add("date-cells","8桁のマス目に入れる",`${year}${String(month).padStart(2,"0")}${String(day).padStart(2,"0")}`,"西暦4桁、月2桁、日2桁です。マス目の数を確認してください。");const formatter=new Intl.DateTimeFormat("ja-JP-u-ca-japanese",{era:"long",year:"numeric",month:"numeric",day:"numeric",timeZone:"UTC"});const parts=formatter.formatToParts(date);const get=(type:string)=>parts.find(part=>part.type===type)?.value??"";add("date-japanese","和暦の年月日にする",`${get("era")}${get("year")}年${month}月${day}日`,"和暦の改元日も照合します。原書類の指定を確認してください。");}}
  return suggestions;
}

/** Modern Gregorian administrative dates only; invalid days and cross-era dates are rejected. */
export function parseJapaneseDate(input:string):Date|null {
  const value=input.trim().replace(/[０-９]/g,char=>String.fromCharCode(char.charCodeAt(0)-0xFEE0));let year:number,month:number,day:number;let era:string|undefined,eraYear:number|undefined;
  const western=value.match(/^(\d{4})\s*(?:年|[/.\-])\s*(\d{1,2})\s*(?:月|[/.\-])\s*(\d{1,2})\s*日?$/)??value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if(western){year=Number(western[1]);month=Number(western[2]);day=Number(western[3]);}
  else {const match=value.match(/^(令和|平成|昭和|大正|明治|R|H|S|T|M)\s*(元|\d{1,3})\s*(?:年|[/.\-])\s*(\d{1,2})\s*(?:月|[/.\-])\s*(\d{1,2})\s*日?$/i);if(!match)return null;const map:Record<string,[string,number]>={令和:["令和",2019],R:["令和",2019],平成:["平成",1989],H:["平成",1989],昭和:["昭和",1926],S:["昭和",1926],大正:["大正",1912],T:["大正",1912],明治:["明治",1868],M:["明治",1868]};[era,year]=map[match[1].toUpperCase()];eraYear=match[2]==="元"?1:Number(match[2]);year+=eraYear-1;month=Number(match[3]);day=Number(match[4]);}
  if(year<1873||year>9999||month<1||month>12||day<1||day>31||eraYear!==undefined&&eraYear<1)return null;
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  if(era){const parts=new Intl.DateTimeFormat("ja-JP-u-ca-japanese",{era:"long",year:"numeric",timeZone:"UTC"}).formatToParts(date);if(parts.find(p=>p.type==="era")?.value!==era)return null;const formattedYear=parts.find(p=>p.type==="year")?.value;if((formattedYear==="元"?1:Number(formattedYear))!==eraYear)return null;}
  return date;
}
