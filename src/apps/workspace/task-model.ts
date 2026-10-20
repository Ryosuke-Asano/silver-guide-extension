import { pdfFieldApplicability,pdfFieldPageIndices,pdfFieldReadOnly,pdfFieldSourceReadOnly, type PdfAnalysis, type PdfAnswers, type PdfField, type PdfPageInfo, type PdfNativeConstraints, type PdfDocumentInfo } from "../../domain/pdf";
import { validatePdfFields } from "../../adapters/pdf/validation";

export type PdfStage = "mapping" | "filling" | "reviewing" | "saved";
export type AnswerStatus = "empty" | "entered" | "deferred" | "not-applicable" | "needs-review";
export type PdfAnswerFormat={raw:string;formatted:string;formatId:string;appliedAt:string;active:boolean};
/** Past explicit answer reviews are audit data, never a substitute for current writer validation. */
export type PdfAnswerReview={fieldId:string;fieldRevision:number;taskRevision:number;confirmedAt:string};
export type PdfMappingSnapshot = { fields: PdfField[]; answers: PdfAnswers; answerStatus: Record<string, AnswerStatus>; pages?: PdfPageInfo[] };
export type PdfTask = {
  schemaVersion: 1;
  kind: "pdf";
  id: string;
  revision: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  stage: PdfStage;
  analysis: PdfAnalysis;
  fields: PdfField[];
  answers: PdfAnswers;
  answerStatus: Record<string, AnswerStatus>;
  pages: PdfPageInfo[];
  selectedFieldId: string | null;
  originalHash: string;
  allowIncomplete: boolean;
  exportMode: "editable-form" | "print" | "overlay";
  actionRemovalConfirmed: boolean;
  mappingHistory?:PdfMappingSnapshot[];
  mappingRedo?:PdfMappingSnapshot[];
  answerFormats?:Record<string,PdfAnswerFormat>;
  formatHistory?:Array<PdfAnswerFormat&{fieldId:string}>;
  answerReviewHistory?:PdfAnswerReview[];
  templateTrackingVersion?:1;
};

export function createPdfTask(analysis: PdfAnalysis): PdfTask {
  const now = new Date().toISOString();
  const answers: PdfAnswers = {};
  const answerStatus: PdfTask["answerStatus"] = {};
  for (const field of analysis.fields) {
    answers[field.id] = field.initialValue;
    answerStatus[field.id] = field.initialValue !== null && field.initialValue !== "" && field.initialValue !== false && !(Array.isArray(field.initialValue)&&field.initialValue.length===0) ? "entered" : "empty";
  }
  return {
    schemaVersion: 1, kind: "pdf", id: crypto.randomUUID(), revision: 1,
    title: analysis.document.name, createdAt: now, updatedAt: now,
    stage: "filling", analysis,
    // Internal native fields with no visible widget cannot accept a visual answer.
    // Leave their source value untouched instead of asking a question that cannot
    // be exported. A visible missing box can be added explicitly as an overlay.
    fields: structuredClone(analysis.fields).map(field=>field.native&&!field.placements.length?{...field,mappingState:"rejected" as const}:field), answers, answerStatus,
    pages: structuredClone(analysis.document.pages), selectedFieldId: analysis.fields[0]?.id ?? null,
    originalHash: analysis.document.hash, allowIncomplete: false, actionRemovalConfirmed: false,
    exportMode: analysis.fields.some(field => field.native !== null) ? "editable-form" : "overlay"
  };
}

export function updatePdfTask(task: PdfTask, update: Partial<PdfTask>): PdfTask {
  const changesOutput = ["fields", "answers", "answerStatus", "pages", "allowIncomplete", "exportMode", "actionRemovalConfirmed"].some(key => key in update);
  // Reentry retires only old certainty. Subsequent explicit edits while active
  // remain available for condition/original confirmation, including stale templates.
  if(update.fields){const fields=guardPdfFieldReinclusion(task.fields,update.fields);if(fields!==update.fields)update={...update,fields};}
  return { ...task, ...update, revision: task.revision + (changesOutput ? 1 : 0), updatedAt: new Date().toISOString(), stage: update.stage ?? (changesOutput && task.stage === "saved" ? "reviewing" : task.stage) };
}

function guardPdfFieldReinclusion(previous: PdfField[], next: PdfField[]): PdfField[] {
  const rejected = new Map(previous.filter(field => field.mappingState === "rejected").map(field => [field.id, field]));
  let changed = false;
  const guarded = next.map(field => {
    const prior = rejected.get(field.id);
    if (!prior || field.mappingState === "rejected") return field;
    const conditionStatus = field.conditionStatus === "confirmed" ? "unknown" : field.conditionStatus;
    if (field.mappingState === "needs-review" && conditionStatus === field.conditionStatus) return field;
    changed = true;
    return { ...field, revision: Math.max(field.revision, prior.revision + 1), mappingState: "needs-review" as const, conditionStatus };
  });
  return changed ? guarded : next;
}

/** History snapshots own independent JSON data, including the person's page decisions. */
export function snapshotPdfMapping(task: PdfTask): PdfMappingSnapshot & { pages: PdfPageInfo[] } {
  return structuredClone({ fields: task.fields, answers: task.answers, answerStatus: task.answerStatus, pages: task.pages });
}

export class PdfMappingRestoreError extends Error {
  readonly code = "ANSWER_LIMIT";
  constructor() { super("保持する回答の数が上限の 10,000 件を超えるため、履歴の内容を復元できません。現在の入力はそのまま残っています。"); this.name = "PdfMappingRestoreError"; }
}

/** Stable comparison for in-memory mapping history. No guide registry is required. */
function canonicalJson(value: unknown): string {
  if(value === null || typeof value !== "object") return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(",")}}`;
}

function pdfComparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pdfComparable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, pdfComparable(item)]));
  return value;
}
function pdfFieldMeaning(field: PdfField): string {
  const { revision: _revision, mappingState: _mapping, confidence: _confidence, templateBinding, ...meaning } = field;
  const binding = templateBinding ? (({ review: _review, ...origin }) => origin)(templateBinding) : null;
  return canonicalJson(pdfComparable({ ...meaning, templateBinding: binding }));
}
function pdfFieldCondition(field: PdfField): string {
  return canonicalJson(pdfComparable({ condition: field.condition, conditionStatus: field.conditionStatus, conditionSource: field.conditionSource ?? null }));
}
function pdfRetainedAnswer(value: PdfAnswers[string] | undefined): boolean {
  return value !== undefined && value !== null && value !== "" && value !== false && !(Array.isArray(value) && !value.length);
}

/** Mapping history changes questions/pages; the latest answers always take precedence. */
export function restorePdfMappingSnapshot(current: PdfTask, snapshot: PdfMappingSnapshot): Partial<PdfTask> {
  const answers = { ...snapshot.answers, ...current.answers }, answerStatus = { ...snapshot.answerStatus, ...current.answerStatus };
  if (Object.keys(answers).length > 10_000 || Object.keys(answerStatus).length > 10_000) throw new PdfMappingRestoreError();
  const restored = structuredClone(snapshot), previous = new Map(current.fields.map(field => [field.id, field]));
  const affectedPages = new Set<number>(), attention: string[] = [];
  const fields = restored.fields.map(field => {
    if (field.mappingState === "rejected") return field;
    const prior = previous.get(field.id), reentered = !prior || prior.mappingState === "rejected";
    const changedMeaning = !!prior && pdfFieldMeaning(prior) !== pdfFieldMeaning(field);
    if (!reentered && (!changedMeaning || pdfFieldReadOnly(field))) return field;
    const changedCondition = !prior || pdfFieldCondition(prior) !== pdfFieldCondition(field);
    for (const index of [...(prior ? pdfFieldPageIndices(prior) : []), ...pdfFieldPageIndices(field)]) affectedPages.add(index);
    attention.push(field.id);
    if (pdfRetainedAnswer(answers[field.id])) answerStatus[field.id] = "needs-review";
    return { ...field, revision: Math.max(field.revision, (prior?.revision ?? field.revision) + 1), mappingState: "needs-review" as const,
      conditionStatus: field.conditionStatus === "confirmed" && (reentered || changedCondition) ? "unknown" as const : field.conditionStatus };
  });
  const pages = (restored.pages ?? current.pages).map(page => affectedPages.has(page.index) ? { ...page, review: "unseen" as const } : page);
  return { fields, answers: structuredClone(answers), answerStatus, pages,
    ...(attention.length ? { stage: "mapping" as const, selectedFieldId: attention[0] } : {}) };
}

export type PdfPageReviewPlan = { update: Partial<PdfTask> | null; affectedFieldIds: string[]; sharedPageIndices: number[]; reason: string | null };

/** Inspect the whole placement union before changing any page or field. */
export function planPdfPageReview(task: PdfTask, pageIndices: readonly number[], review: PdfPageInfo["review"]): PdfPageReviewPlan {
  const unchanged = (reason: string | null = null, sharedPageIndices: number[] = []): PdfPageReviewPlan => ({ update: null, affectedFieldIds: [], sharedPageIndices, reason });
  if (!pageIndices.length || pageIndices.length > 100 || pageIndices.some(index => !Number.isInteger(index) || index < 0 || index >= task.pages.length)
    || !["inputs-confirmed", "no-inputs-confirmed", "excluded", "unseen"].includes(review)) return unchanged("確認するページを選び直してください。");
  const selected = new Set(pageIndices), excluding = review === "no-inputs-confirmed" || review === "excluded";
  const reentering = review === "unseen";
  const relevant = new Set(task.fields.filter(field => excluding ? field.mappingState !== "rejected" : reentering && field.mappingState === "rejected"));
  const fieldPages = new Map<PdfField, number[]>(), pageFields = new Map<number, PdfField[]>();
  for (const field of relevant) {
    const pages = pdfFieldPageIndices(field); fieldPages.set(field, pages);
    for (const index of pages) { const members = pageFields.get(index) ?? []; members.push(field); pageFields.set(index, members); }
  }
  const closure = new Set(selected), queue = [...selected], visitedFields = new Set<PdfField>();
  for (let offset = 0; offset < queue.length; offset++) for (const field of pageFields.get(queue[offset]) ?? []) {
    if (visitedFields.has(field)) continue; visitedFields.add(field);
    for (const index of fieldPages.get(field)!) if (!closure.has(index)) { closure.add(index); queue.push(index); }
  }
  if (closure.size !== selected.size) return unchanged("複数のページにまたがる項目です。関係するページをまとめて確認してください。", [...closure].sort((a, b) => a - b));
  const affectedFieldIds: string[] = [];
  const fields = task.fields.map(field => {
    if (!relevant.has(field)) return field;
    const pages = fieldPages.get(field)!;
    if (!pages.length || !pages.every(index => selected.has(index))) return field;
    affectedFieldIds.push(field.id);
    return { ...field, revision: field.revision + 1, mappingState: excluding ? "rejected" as const : "needs-review" as const,
      conditionStatus: reentering && field.conditionStatus === "confirmed" ? "unknown" as const : field.conditionStatus };
  });
  const pages = task.pages.map(page => selected.has(page.index) && page.review !== review ? { ...page, review } : page);
  const pagesChanged = pages.some((page, index) => page !== task.pages[index]);
  if (!affectedFieldIds.length && !pagesChanged) return unchanged();
  const update: Partial<PdfTask> = { ...(pagesChanged ? { pages } : {}), ...(affectedFieldIds.length ? { fields } : {}) };
  if (reentering) { update.stage = "mapping"; if (affectedFieldIds.length) update.selectedFieldId = affectedFieldIds[0]; }
  if (excluding && task.selectedFieldId && affectedFieldIds.includes(task.selectedFieldId)) update.selectedFieldId = fields.find(field => field.mappingState !== "rejected")?.id ?? null;
  return { update, affectedFieldIds, sharedPageIndices: [], reason: null };
}

/** Return one atomic update for the caller to commit; a blocked/no-op action adds no history. */
export function applyPdfPageReview(task: PdfTask, pageIndices: readonly number[], review: PdfPageInfo["review"]): PdfPageReviewPlan {
  const plan = planPdfPageReview(task, pageIndices, review);
  if (!plan.update) return plan;
  return { ...plan, update: { ...plan.update, mappingHistory: [...(task.mappingHistory ?? []), snapshotPdfMapping(task)].slice(-20), mappingRedo: [] } };
}

function nativeConstraintRefresher(constraints:PdfNativeConstraints):(field:PdfField)=>PdfField{
  const identity=(name:string,ref:string)=>`${ref}\u0000${name}`,lookup=new Map<string,PdfNativeConstraints["fields"][number]|null>();
  for(const item of constraints.fields){const key=identity(item.name,item.fieldRef);lookup.set(key,lookup.has(key)?null:item);}
  return(field:PdfField):PdfField=>{
    if(!field.native)return field;const original=lookup.get(identity(field.native.name,field.native.fieldRef)),native={...field.native};
    if(original){native.originalReadOnly=original.originalReadOnly;native.unsupported=original.unsupported;native.referenceKind=original.referenceKind;}
    else{delete native.originalReadOnly;delete native.unsupported;}
    const roleExcluded=field.role==="office"||field.role==="signature"||field.kind==="signature";
    // A deliberate true value outside role exclusions remains a task restriction.
    // Role-derived values are recomputed so changing office to applicant is legal.
    const explicit=field.readOnly&&!roleExcluded&&field.native.originalReadOnly!==true&&field.native.unsupported!==true&&field.native.referenceKind!=="read-only-widget";
    const updated={...field,native,...(original?{initialValue:structuredClone(original.initialValue)}:{})};return{...updated,readOnly:pdfFieldSourceReadOnly(updated)||roleExcluded||explicit};
  };
}
export function hydratePdfFieldsNativeConstraints(fields:PdfField[],constraints:PdfNativeConstraints,documentHash:string):PdfField[]{
  return documentHash===constraints.documentHash?fields.map(nativeConstraintRefresher(constraints)):fields;
}
/** Refresh only original restrictions. User mappings/answers and document identity stay owned by the task. */
export function hydratePdfTaskNativeConstraints(task:PdfTask,constraints:PdfNativeConstraints,source?:Pick<PdfDocumentInfo,"hash"|"capabilities"|"actionDependent"|"issues">):PdfTask{
  if(task.originalHash!==constraints.documentHash||task.analysis.document.hash!==constraints.documentHash||source&&source.hash!==constraints.documentHash)return task;
  const refresh=nativeConstraintRefresher(constraints),next=structuredClone(task);next.fields=next.fields.map(refresh);next.analysis.fields=next.analysis.fields.map(refresh);
  for(const history of [next.mappingHistory,next.mappingRedo])for(const item of history??[])item.fields=item.fields.map(refresh);
  if(source){next.analysis.document.capabilities=structuredClone(source.capabilities);next.analysis.document.actionDependent=source.actionDependent;next.analysis.document.issues=structuredClone(source.issues);}
  return next;
}

export function isPdfTask(value: unknown): value is PdfTask {
  try{return safePdfTaskGraph(value)&&validPdfTask(value);}catch{return false;}
}

type DataObject=Record<string,unknown>;
const pdfObject=(value:unknown):value is DataObject=>!!value&&typeof value==="object"&&!Array.isArray(value);
const pdfText=(value:unknown,max=200_000):value is string=>typeof value==="string"&&value.length<=max;
const pdfId=(value:unknown):value is string=>pdfText(value,256)&&value.length>0&&!["__proto__","constructor","prototype"].includes(value);
const pdfNumber=(value:unknown,max=1e12):value is number=>typeof value==="number"&&Number.isFinite(value)&&Math.abs(value)<=max;
const pdfInteger=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const pdfArray=(value:unknown,max:number):value is unknown[]=>Array.isArray(value)&&value.length<=max;
const pdfOneOf=(value:unknown,values:readonly unknown[])=>values.includes(value);
const optionalPdf=(object:DataObject,key:string,check:(value:unknown)=>boolean)=>object[key]===undefined||check(object[key]);

/** Reject cycles, accessors, prototype objects and unbounded graphs before reading properties.
 * Bound in-memory task metadata. Shared acyclic objects are valid.
 */
function safePdfTaskGraph(value:unknown):boolean{
  const active=new Set<object>(),done=new Set<object>();let nodes=0,textUnits=0;
  const stack:Array<{value:unknown;depth:number;exit?:boolean}>=[{value,depth:0}];
  while(stack.length){const item=stack.pop()!,current=item.value;if(++nodes>2_000_000||item.depth>64)return false;
    if(typeof current==="string"){if((textUnits+=current.length)>16*1024*1024)return false;continue;}
    if(current===null||current===undefined||typeof current==="boolean")continue;
    if(typeof current==="number"){if(!Number.isFinite(current))return false;continue;}
    if(typeof current!=="object")return false;
    if(item.exit){active.delete(current);done.add(current);continue;}if(active.has(current))return false;if(done.has(current))continue;
    const array=Array.isArray(current),prototype=Object.getPrototypeOf(current);if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return false;
    if(array&&current.length>200_000)return false;const properties=Object.getOwnPropertyDescriptors(current),keys=Reflect.ownKeys(properties);if(keys.length>(array?200_001:10_000))return false;
    if(array&&keys.length!==current.length+1)return false;active.add(current);stack.push({value:current,depth:item.depth,exit:true});
    for(const key of keys){if(typeof key!=="string"||["__proto__","constructor","prototype"].includes(key))return false;if(array&&key==="length")continue;if(array&&(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=current.length))return false;const descriptor=properties[key];if(!("value"in descriptor))return false;stack.push({value:descriptor.value,depth:item.depth+1});}
  }return true;
}
function pdfDate(value:unknown):boolean{
  if(!pdfText(value,40))return false;const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);if(!match||!Number.isFinite(Date.parse(value)))return false;
  const [,y,m,d,h,minute,s]=match.map(Number),date=new Date(0);date.setUTCFullYear(y,m-1,d);date.setUTCHours(h,minute,s,0);return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d&&date.getUTCHours()===h&&date.getUTCMinutes()===minute&&date.getUTCSeconds()===s;
}
function pdfRawBox(value:unknown):value is unknown[]{return pdfArray(value,4)&&value.length===4&&value.every(n=>pdfNumber(n,1e9));}
function pdfBox(value:unknown):boolean{return pdfRawBox(value)&&Number(value[2])>Number(value[0])&&Number(value[3])>Number(value[1]);}
function pdfQuad(value:unknown):boolean{return pdfArray(value,4)&&value.length===4&&value.every(point=>pdfObject(point)&&pdfNumber(point.x,1e9)&&pdfNumber(point.y,1e9));}
function pdfAnswer(value:unknown):boolean{return value===null||typeof value==="boolean"||pdfText(value)||pdfArray(value,5000)&&value.every(item=>pdfText(item));}
function pdfRecord(value:unknown,check:(item:unknown)=>boolean,max=10_000):boolean{return pdfObject(value)&&Object.keys(value).length<=max&&Object.entries(value).every(([key,item])=>pdfId(key)&&check(item));}
function pdfRule(value:unknown):boolean{
  let remaining=200;const check=(node:unknown,depth:number):boolean=>{
    if(--remaining<0||depth>16||!pdfObject(node))return false;
    const keys=Object.keys(node);if(node.op==="eq")return keys.every(key=>["op","fieldId","value"].includes(key))&&pdfId(node.fieldId)&&(typeof node.value==="boolean"||pdfText(node.value));
    if(node.op==="present")return keys.every(key=>["op","fieldId"].includes(key))&&pdfId(node.fieldId);if(node.op==="not")return keys.every(key=>["op","arg"].includes(key))&&check(node.arg,depth+1);
    return pdfOneOf(node.op,["all","any"])&&keys.every(key=>["op","args"].includes(key))&&pdfArray(node.args,200)&&node.args.every(arg=>check(arg,depth+1));
  };return check(value,0);
}
function pdfPlacement(value:unknown,pageCount:number):boolean{
  return pdfObject(value)&&pdfInteger(value.pageIndex,0,pageCount-1)&&pdfQuad(value.quad)&&(value.widgetRef===null||pdfText(value.widgetRef,128))&&pdfOneOf(value.writingMode,["horizontal","vertical"])&&optionalPdf(value,"cells",cells=>pdfArray(cells,100)&&cells.every(pdfQuad));
}
function pdfTemplateBinding(value:unknown):boolean{
  if(!pdfObject(value)||Object.keys(value).some(key=>!["schemaVersion","templateId","templateVersion","templateFieldId","match","originalHash","layoutFingerprint","descriptorHash","fieldSemanticHash","adoptedAt","source","review"].includes(key)))return false;
  const id=(entry:unknown)=>typeof entry==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(entry),hash=(entry:unknown)=>typeof entry==="string"&&/^[a-f0-9]{64}$/.test(entry);
  if(value.schemaVersion!==1||!id(value.templateId)||!pdfText(value.templateVersion,128)||!value.templateVersion.length||!id(value.templateFieldId)||!pdfOneOf(value.match,["exact","layout-candidate"])||!hash(value.originalHash)||!(value.layoutFingerprint===null||hash(value.layoutFingerprint))||!hash(value.descriptorHash)||!hash(value.fieldSemanticHash)||!pdfDate(value.adoptedAt)||!pdfObject(value.source)||!pdfObject(value.review))return false;
  const source=value.source;
  // Signed guide dates retain their exact spelling, including accepted date-only values.
  const sourceDate=(entry:unknown)=>pdfText(entry,40)&&typeof entry==="string"&&Number.isFinite(Date.parse(entry));
  if(Object.keys(source).some(key=>!["keyId","packageId","release","payloadHash","sourceURL","reviewedAt","validUntil","packageValidUntil"].includes(key))||!id(source.keyId)||!id(source.packageId)||!pdfInteger(source.release,1)||!hash(source.payloadHash)||!pdfText(source.sourceURL,2048)||!sourceDate(source.reviewedAt)||!sourceDate(source.validUntil)||!sourceDate(source.packageValidUntil)||Date.parse(String(source.validUntil))<Date.parse(String(source.reviewedAt)))return false;
  try{const url=new URL(source.sourceURL as string);if(url.protocol!=="https:"||url.username||url.password)return false;}catch{return false;}
  const review=value.review;
  if(Object.keys(review).some(key=>!["state","reason","invalidationKey","confirmedAt"].includes(key))||!pdfOneOf(review.state,["current","needs-review","manual-confirmed"])||!(review.reason===null||pdfOneOf(review.reason,["expired","revoked","untrusted","changed","unavailable","verification-failed"]))||!(review.invalidationKey===null||pdfText(review.invalidationKey,8192))||!optionalPdf(review,"confirmedAt",pdfDate))return false;
  if(review.state==="current")return review.reason===null&&review.invalidationKey===null;
  return review.reason!==null&&typeof review.invalidationKey==="string"&&review.invalidationKey.length>0&&(review.state!=="manual-confirmed"||pdfDate(review.confirmedAt));
}
function pdfField(value:unknown,pageCount:number):boolean{
  if(!pdfObject(value)||!pdfId(value.id)||!pdfInteger(value.revision,1)||!pdfOneOf(value.source,["acroform","inferred","manual"])||!pdfOneOf(value.kind,["text","multiline","date","number","checkbox","radio","select","signature","unknown"])||!pdfText(value.label)||!pdfText(value.labelOriginal)||!pdfText(value.description)||!pdfOneOf(value.role,["applicant","proxy","organization","office","signature","unknown"])||!(value.subjectId===null||pdfId(value.subjectId))||!optionalPdf(value,"subjectLabel",item=>pdfText(item,1000))||!pdfOneOf(value.required,[true,false,"unknown"])||!pdfArray(value.requiredEvidenceIds,10_000)||!value.requiredEvidenceIds.every(pdfId)||!pdfOneOf(value.conditionStatus,["unconditional","confirmed","unknown"])||!(value.condition===null||pdfRule(value.condition))||!pdfArray(value.placements,10_000)||!value.placements.every(item=>pdfPlacement(item,pageCount))||!pdfArray(value.options,5000)||!value.options.every(option=>pdfObject(option)&&pdfText(option.id)&&pdfText(option.label)&&(option.exportValue===null||pdfText(option.exportValue))&&pdfArray(option.placements,10_000)&&option.placements.every(item=>pdfPlacement(item,pageCount)))||!pdfAnswer(value.initialValue)||!(value.maxGraphemes===null||pdfInteger(value.maxGraphemes))||typeof value.readOnly!=="boolean"||!pdfOneOf(value.mappingState,["proposed","needs-review","confirmed","rejected","manual"])||!pdfArray(value.evidenceIds,10_000)||!value.evidenceIds.every(pdfId))return false;
  if(!optionalPdf(value,"requiredSource",source=>pdfObject(source)&&pdfOneOf(source.kind,["native","document","manual"])&&pdfText(source.text)&&optionalPdf(source,"pageIndex",index=>pdfInteger(index,0,pageCount-1)))||!optionalPdf(value,"conditionSource",source=>pdfObject(source)&&pdfText(source.text)&&pdfInteger(source.pageIndex,0,pageCount-1)))return false;
  const native=value.native;if(native!==null&&(!pdfObject(native)||!pdfText(native.name,20_000)||!pdfText(native.fieldRef,128)||!/^\d{1,10} \d{1,5} R$/.test(native.fieldRef)||!pdfArray(native.widgetRefs,10_000)||!native.widgetRefs.every(ref=>pdfText(ref,128)&&/^\d{1,10} \d{1,5} R$/.test(ref))||!(native.maxLength===null||pdfInteger(native.maxLength))||native.lengthUnit!=="utf16-code-unit"||typeof native.multiSelect!=="boolean"||typeof native.editableSelect!=="boolean"||!optionalPdf(native,"originalRequired",item=>typeof item==="boolean")||!optionalPdf(native,"originalReadOnly",item=>typeof item==="boolean")||!optionalPdf(native,"unsupported",item=>typeof item==="boolean")||!optionalPdf(native,"referenceKind",item=>pdfOneOf(item,["field","read-only-widget"]))))return false;
  const confidence=value.confidence;if(!pdfObject(confidence)||![confidence.text,confidence.geometry,confidence.labelMapping].every(item=>item===null||pdfNumber(item,1)&&item>=0)||!(confidence.calibrationVersion===null||pdfText(confidence.calibrationVersion,256)))return false;
  return optionalPdf(value,"templateBinding",pdfTemplateBinding)&&optionalPdf(value,"style",style=>pdfObject(style)&&optionalPdf(style,"fontSizePt",size=>pdfNumber(size,1000))&&optionalPdf(style,"allowSmallFont",item=>typeof item==="boolean")&&optionalPdf(style,"alignment",alignment=>pdfOneOf(alignment,["left","center","right"])));
}
function pdfFields(value:unknown,pageCount:number):boolean{return pdfArray(value,5000)&&value.every(field=>pdfField(field,pageCount))&&new Set(value.map(field=>(field as DataObject).id)).size===value.length;}
function pdfPage(value:unknown,index:number):boolean{
  return pdfObject(value)&&value.index===index&&pdfText(value.label,1000)&&(value.mediaBox===null||pdfRawBox(value.mediaBox))&&(value.cropBox===null||pdfRawBox(value.cropBox))&&pdfBox(value.visibleBox)&&pdfOneOf(value.rotation,[0,90,180,270])&&pdfNumber(value.userUnit,75000)&&value.userUnit>0&&pdfNumber(value.widthPt)&&value.widthPt>0&&pdfNumber(value.heightPt)&&value.heightPt>0&&pdfOneOf(value.extraction,["native","image","mixed","unusable"])&&pdfOneOf(value.review,["unseen","inputs-confirmed","no-inputs-confirmed","excluded"]);
}
function pdfPages(value:unknown,pageCount:number):boolean{return pdfArray(value,100)&&value.length===pageCount&&value.every(pdfPage);}
function pdfPageGeometryMatches(value:unknown,original:unknown):boolean{
  return Array.isArray(value)&&Array.isArray(original)&&value.length===original.length&&value.every((page,index)=>pdfObject(page)&&pdfObject(original[index])&&["mediaBox","cropBox","visibleBox","rotation","userUnit","widthPt","heightPt"].every(key=>JSON.stringify(page[key])===JSON.stringify(original[index][key])));
}
function pdfIssue(value:unknown,pageCount:number):boolean{return pdfObject(value)&&pdfText(value.code,256)&&pdfText(value.message)&&pdfOneOf(value.severity,["info","warning","error"])&&optionalPdf(value,"pageIndex",index=>pdfInteger(index,0,pageCount-1))&&optionalPdf(value,"fieldId",pdfId);}
function pdfFormat(value:unknown):boolean{return pdfObject(value)&&pdfText(value.raw)&&pdfText(value.formatted)&&pdfId(value.formatId)&&pdfDate(value.appliedAt)&&typeof value.active==="boolean";}
function validPdfTask(value:unknown):boolean{
  if(!pdfObject(value)||value.schemaVersion!==1||value.kind!=="pdf"||!pdfId(value.id)||!pdfInteger(value.revision,1)||!pdfText(value.title,1000)||!pdfDate(value.createdAt)||!pdfDate(value.updatedAt)||!pdfOneOf(value.stage,["mapping","filling","reviewing","saved"])||!pdfText(value.originalHash,64)||! /^[a-f0-9]{64}$/.test(value.originalHash)||typeof value.allowIncomplete!=="boolean"||typeof value.actionRemovalConfirmed!=="boolean"||!pdfOneOf(value.exportMode,["editable-form","print","overlay"])||!pdfObject(value.analysis))return false;
  const analysis=value.analysis,doc=analysis.document;if(!pdfObject(doc)||!pdfId(doc.id)||doc.hash!==value.originalHash||!pdfText(doc.name,1000)||!pdfInteger(doc.byteLength,1,100*1024*1024)||!pdfInteger(doc.pageCount,1,100))return false;const pageCount=doc.pageCount;
  if(!pdfPages(doc.pages,pageCount)||!pdfPages(value.pages,pageCount)||!pdfFields(analysis.fields,pageCount)||!pdfFields(value.fields,pageCount)||!pdfRecord(value.answers,pdfAnswer)||!pdfRecord(value.answerStatus,status=>pdfOneOf(status,["empty","entered","deferred","not-applicable","needs-review"]))||!pdfObject(doc.capabilities)||!["read","analyze","nativeWrite","overlayWrite","export"].every(key=>{const capability=doc.capabilities as DataObject,item=capability[key];return pdfObject(item)&&typeof item.allowed==="boolean"&&(item.reason===null||pdfText(item.reason));})||!pdfArray(doc.issues,10_000)||!doc.issues.every(issue=>pdfIssue(issue,pageCount))||typeof doc.actionDependent!=="boolean"||!pdfArray(analysis.issues,10_000)||!analysis.issues.every(issue=>pdfIssue(issue,pageCount))||typeof analysis.complete!=="boolean"||!pdfArray(analysis.evidence,200_000)||!analysis.evidence.every(item=>pdfObject(item)&&pdfId(item.id)&&pdfInteger(item.pageIndex,0,pageCount-1)&&pdfText(item.text)&&pdfQuad(item.quad)&&pdfOneOf(item.method,["native","ocr"])&&(item.rawOcrConfidence===null||pdfNumber(item.rawOcrConfidence,100)&&item.rawOcrConfidence>=-1)))return false;
  if(!(value.selectedFieldId===null||pdfId(value.selectedFieldId)&&(value.fields as DataObject[]).some(field=>field.id===value.selectedFieldId)))return false;
  if(!pdfPageGeometryMatches(value.pages,doc.pages))return false;
  const history=(items:unknown)=>pdfArray(items,20)&&items.every(snapshot=>pdfObject(snapshot)&&pdfFields(snapshot.fields,pageCount)&&pdfRecord(snapshot.answers,pdfAnswer)&&pdfRecord(snapshot.answerStatus,status=>pdfOneOf(status,["empty","entered","deferred","not-applicable","needs-review"]))&&optionalPdf(snapshot,"pages",pages=>pdfPages(pages,pageCount)&&pdfPageGeometryMatches(pages,doc.pages)));
  // Completion checks belong to getPdfTaskIssues: unfinished or off-page mappings
  // and historical/orphan answer provenance remain available for the user to repair.
  const boundToOriginal=(fields:unknown)=>Array.isArray(fields)&&fields.every(field=>!pdfObject(field)||!field.templateBinding||pdfObject(field.templateBinding)&&field.templateBinding.originalHash===value.originalHash);
  if(!boundToOriginal(value.fields)||!boundToOriginal(analysis.fields)||[value.mappingHistory,value.mappingRedo].some(history=>Array.isArray(history)&&history.some(snapshot=>pdfObject(snapshot)&&!boundToOriginal(snapshot.fields))))return false;
  return optionalPdf(value,"templateTrackingVersion",version=>version===1)&&optionalPdf(value,"mappingHistory",history)&&optionalPdf(value,"mappingRedo",history)&&optionalPdf(value,"answerFormats",items=>pdfRecord(items,pdfFormat))&&optionalPdf(value,"formatHistory",items=>pdfArray(items,40)&&items.every(item=>pdfFormat(item)&&pdfObject(item)&&pdfId(item.fieldId)))&&optionalPdf(value,"answerReviewHistory",items=>pdfArray(items,40)&&items.every(item=>pdfObject(item)&&Object.keys(item).every(key=>["fieldId","fieldRevision","taskRevision","confirmedAt"].includes(key))&&pdfId(item.fieldId)&&pdfInteger(item.fieldRevision,1)&&pdfInteger(item.taskRevision,1,Number(value.revision))&&pdfDate(item.confirmedAt)));
}

export function getDirectPdfTaskIssues(task:PdfTask):Array<{fieldId?:string;pageIndex?:number;message:string}>{
  return validatePdfFields(task.fields,task.answers,task.pages,{inputMode:"direct",allowIncomplete:true,answerStatus:task.answerStatus}).map(({fieldId,pageIndex,message})=>({fieldId,pageIndex,message}));
}

export function getPdfTaskIssues(task: PdfTask): Array<{ fieldId?: string; pageIndex?: number; message: string }> {
  const issues: Array<{ fieldId?: string; pageIndex?: number; message: string }> = [];
  for (const page of task.pages) if (page.review === "unseen") issues.push({ pageIndex: page.index, message: `${page.index + 1}ページの入力欄を確認してください。` });
  for (const field of task.fields) {
    if (field.mappingState === "rejected") continue;
    if(!pdfFieldReadOnly(field)&&field.templateBinding?.review.state==="needs-review")issues.push({fieldId:field.id,pageIndex:field.placements[0]?.pageIndex,message:`「${field.label}」に採用した様式の案内が変わったか、現在確認できません。元の書類でこの項目を確認してください。`});
    if (task.analysis.document.capabilities.export.allowed && pdfFieldSourceReadOnly(field)) {
      const retained = task.answers[field.id];
      const empty = retained === null || retained === undefined || retained === "" || (Array.isArray(retained) && retained.length === 0);
      if (!empty && JSON.stringify(retained) !== JSON.stringify(field.initialValue)) issues.push({ fieldId: field.id, pageIndex: field.placements[0]?.pageIndex, message: `「${field.label}」は原本の指定で記入できません。残っている回答を確認し、この回答を記入対象から外してください。` });
    }
    if (pdfFieldReadOnly(field)) continue;
    if (field.mappingState !== "confirmed" && field.mappingState !== "manual") issues.push({ fieldId: field.id, message: `「${field.label}」の意味と記入場所を確認してください。` });
    if (field.role === "unknown") issues.push({ fieldId: field.id, message: `「${field.label}」に誰の情報を書くかを確認してください。` });
    const value = task.answers[field.id];
    const empty = value === null || value === undefined || value === "" || field.kind==="checkbox"&&value===false || (Array.isArray(value) && value.length === 0);
    if (!task.allowIncomplete && field.required === true && pdfFieldApplicability(field,task.answers,{answerStatus:task.answerStatus})!==false && (empty || task.answerStatus[field.id] === "deferred")) issues.push({ fieldId: field.id, message: `必須の「${field.label}」が未記入です。` });
    if (task.answerStatus[field.id] === "needs-review") issues.push({ fieldId: field.id, message: `「${field.label}」の形式を確認してください。` });
    if (typeof value === "string" && field.native?.maxLength !== null && field.native?.maxLength !== undefined && value.length > field.native.maxLength) issues.push({ fieldId: field.id, message: `「${field.label}」は元のPDFの文字数制限を超えています。` });
  }
  // Preserve the first occurrence/order with the same field+message identity.
  // Issue counts can reach thousands; repeated whole-array scans made this quadratic.
  const issueKey=(fieldId:string|undefined,message:string)=>JSON.stringify([fieldId??null,message]);
  const seen=new Set(issues.map(issue=>issueKey(issue.fieldId,issue.message)));
  for (const issue of validatePdfFields(task.fields, task.answers, task.pages, { allowIncomplete: task.allowIncomplete,answerStatus:task.answerStatus })) {
    const key=issueKey(issue.fieldId,issue.message);if (!seen.has(key)){seen.add(key);issues.push({ fieldId: issue.fieldId, pageIndex: issue.pageIndex, message: issue.message });}
  }
  if (task.analysis.document.actionDependent && !task.actionRemovalConfirmed) issues.push({ message: "計算や検証機能を含むPDFです。印刷用の出力と、失われる機能を確認してください。" });
  return issues;
}

