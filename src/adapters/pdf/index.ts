import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { getWebExtensionApi } from "../../shared/webextension";
import { PDF_MAX_INPUT_BYTES, PDF_MAX_OUTPUT_BYTES, PdfEngineError, pdfAnswerTypeCompatible, pdfFieldReadOnly, quadToBox, rectToQuad, type PdfAnalysis, type PdfAnalyzeOptions, type PdfAssetPaths, type PdfCapabilities, type PdfDocumentInfo, type PdfEvidence, type PdfExportOptions, type PdfExportResult, type PdfField, type PdfIssue, type PdfOpenOptions, type PdfPageInfo, type PdfAffine, type PdfBox, type PdfQuad, type PdfNativeConstraints } from "../../domain/pdf";
import { abortable, abortIfNeeded, area, inverse, iou, multiply, sha256, transformQuad } from "./geometry";
import { extractNativeFields,extractReadOnlyNativeFields,inspectNativePageImages, inspectNativeDocument, nativePageBoxes, type DocumentInspection } from "./native";
import { createCanvas, context2d, deskew, chooseAnalysisRotation, rotateAnalysisCanvas, preferOppositeOcr, type PdfCanvas } from "./raster";
import { detectRasterBoxes, inferFields, mergeTextEvidence, classifyLabel } from "./structure";
import { inspectVectorGeometry } from "./vector";
import { LocalOcr } from "../../workers/pdf/ocr";
import { buildPdfExport, type BuildExportInput, type BuildExportResult } from "./export";
import {lockPdfAssets,localPdfDocumentParameters} from "./local-resources";
export * from "../../domain/pdf";
export { fitText } from "./export";
export { validatePdfFields } from "./validation";
export { transformPoint, transformQuad, inverse, multiply, graphemes } from "./geometry";

const MAX_PAGES=100,MAX_PIXELS=16_000_000;
type ValidatedOutput = Readonly<{ hash:string; originalHash:string; byteLength:number; pageCount:number; mode:PdfExportResult["mode"] }>;
// Object identity alone cannot authenticate mutable byte arrays. Keep immutable
// provenance privately, and hash an owned copy before opening a generated file.
const validatedOutputs = new WeakMap<PdfSession,WeakMap<PdfExportResult,ValidatedOutput>>();
function asset(path:string):string {const api=getWebExtensionApi();return api?api.runtime.getURL(path):new URL(`/${path}`,typeof location!=="undefined"?location.origin:"http://localhost/").href;}
export function defaultPdfAssets():PdfAssetPaths{return {worker:asset("assets/pdfjs/pdf.worker.min.mjs"),cMaps:asset("assets/pdfjs/cmaps/"),standardFonts:asset("assets/pdfjs/standard_fonts/"),wasm:asset("assets/pdfjs/wasm/"),ocrWorker:asset("assets/tesseract/worker.min.js"),ocrCore:asset("assets/tesseract-core/"),ocrLanguages:asset("assets/tessdata"),japaneseFont:asset("assets/fonts/NotoSansJP-Regular.ttf")};}
let pdfJsModule:Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>|undefined;
async function pdfJs(){return pdfJsModule??=import("pdfjs-dist/legacy/build/pdf.mjs");}

export type PdfRenderOptions={scale?:number;signal?:AbortSignal;maxPixels?:number};
export type PdfRenderResult={width:number;height:number;pdfToViewport:PdfAffine;viewportToPdf:PdfAffine};
export type PdfPreviewRenderOptions=PdfRenderOptions&Pick<PdfExportOptions,"fields"|"answers"|"answerStatus"|"mode"|"actionRemovalConfirmed"|"pageReviews">;
type PreviewDocument={key:string;pdf:PDFDocumentProxy;loading:PDFDocumentLoadingTask;worker:import("pdfjs-dist/types/src/display/api").PDFWorker};
function fail(code:string,message:string):PdfEngineError{return new PdfEngineError(code,message);}
function capabilitySet(denied:string|null,hasNative:boolean):PdfCapabilities {return {read:{allowed:true,reason:null},analyze:{allowed:true,reason:null},nativeWrite:{allowed:!denied&&hasNative,reason:denied??(hasNative?null:"この PDF に元からの入力欄はありません。")},overlayWrite:{allowed:!denied,reason:denied},export:{allowed:!denied,reason:denied}};}
function exportPageSnapshot(pages:PdfPageInfo[],pageCount:number,reviews:unknown):PdfPageInfo[]{
  const snapshot=structuredClone(pages);if(reviews===undefined)return snapshot;
  const invalid=()=>fail("INVALID_PAGE_REVIEWS","すべてのページの判断を確認してから、PDF をもう一度作成してください。");
  if(!Array.isArray(reviews)||reviews.length>MAX_PAGES||reviews.length!==pageCount)throw invalid();
  const seen=new Set<number>(),allowed=new Set<PdfPageInfo["review"]>(["unseen","inputs-confirmed","no-inputs-confirmed","excluded"]);
  for(const entry of reviews){if(!entry||typeof entry!=="object")throw invalid();const {pageIndex,review}=entry as {pageIndex:unknown;review:unknown};
    if(typeof pageIndex!=="number"||!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pageCount||seen.has(pageIndex)||typeof review!=="string"||!allowed.has(review as PdfPageInfo["review"]))throw invalid();
    seen.add(pageIndex);snapshot[pageIndex].review=review as PdfPageInfo["review"];
  }
  return snapshot;
}

export class PdfSession {
  readonly info:PdfDocumentInfo;
  private original:Uint8Array;
  private readonly originalHash:string;
  private pdf:PDFDocumentProxy;
  private loading:PDFDocumentLoadingTask;
  private assets:PdfAssetPaths;
  private nativeFields:PdfField[];
  private analysis:PdfAnalysis|null=null;
  private ocr:LocalOcr|null=null;
  private disposed=false;
  private generation=0;
  private activeExport:Worker|null=null;
  private activePreview:Worker|null=null;
  private previewAbort:AbortController|null=null;
  private previewDocument:PreviewDocument|null=null;
  private previewFont:Promise<Uint8Array>|null=null;
  private activeRenders=new Set<{cancel:()=>void}>();
  private ownedControllers=new Set<AbortController>();
  private failedImages=new Set<number>();
  private constructor(bytes:Uint8Array,pdf:PDFDocumentProxy,loading:PDFDocumentLoadingTask,assets:PdfAssetPaths,info:PdfDocumentInfo,nativeFields:PdfField[]){this.original=bytes;this.originalHash=info.hash;this.pdf=pdf;this.loading=loading;this.assets=assets;this.info=info;this.nativeFields=nativeFields;for(const key of Object.keys(this))if(key!=="info")Object.defineProperty(this,key,{enumerable:false});}

  static async open(source:Blob|ArrayBuffer|Uint8Array,options:PdfOpenOptions={}):Promise<PdfSession>{
    return PdfSession.#openCore(source,options,PDF_MAX_INPUT_BYTES);
  }

  static async #openCore(source:Blob|ArrayBuffer|Uint8Array,options:PdfOpenOptions,maxBytes:number):Promise<PdfSession>{
    const overLimit=()=>maxBytes===PDF_MAX_INPUT_BYTES?fail("BYTE_LIMIT","PDF は 100MiB 以下のファイルを選んでください。"):fail("OUTPUT_BYTE_LIMIT","作成する PDF は 160MiB 以下にしてください。記入内容を保持したまま、元のPDFの画像などを確認できます。");
    abortIfNeeded(options.signal);const sourceLength=source instanceof Blob?source.size:source.byteLength;if(sourceLength>maxBytes)throw overLimit();
    const bytes=source instanceof Blob?new Uint8Array(await source.arrayBuffer()):source instanceof Uint8Array?source.slice():new Uint8Array(source.slice(0));abortIfNeeded(options.signal);if(bytes.length>maxBytes)throw overLimit();
    if(!new TextDecoder("ascii").decode(bytes.subarray(0,1024)).includes("%PDF-"))throw fail("NOT_PDF","PDF のデータではありません。認証画面や別のファイルを開いていないか確認してください。");
    const expected=defaultPdfAssets(),assets=lockPdfAssets({...expected,...options.assets},expected);const lib=await pdfJs();if(typeof window!=="undefined")lib.GlobalWorkerOptions.workerSrc=assets.worker;
    options.onProgress?.({stage:"loading",completed:0,total:1});const loading=lib.getDocument({...localPdfDocumentParameters(assets),data:bytes.slice(),password:options.password});
    let cancelledPassword=false;loading.onPassword=(callback:(password:string)=>void,reason:number)=>{if(!options.onPassword){cancelledPassword=true;void loading.destroy();return;}void options.onPassword(reason===2?"incorrect":"required").then(password=>{if(password===null){cancelledPassword=true;void loading.destroy();}else callback(password);}).catch(()=>{cancelledPassword=true;void loading.destroy();});};
    let pdf:PDFDocumentProxy;try{pdf=await abortable(loading.promise,options.signal,()=>{void loading.destroy();});}catch(error){if(cancelledPassword)throw fail("PASSWORD_REQUIRED","パスワードが必要です。PDF を開き直してください。");throw error;}
    try {
      if(pdf.numPages>MAX_PAGES)throw fail("PAGE_LIMIT","PDF は 100ページ 以下のファイルを選んでください。");const issues:PdfIssue[]=[];let native:PDFDocument|null=null,inspection:DocumentInspection|null=null,nativeFields:PdfField[]=[];
      // PDF.js builds this value from xref.encrypt, independently of user Info
      // entries. pdf-lib1.17.1's ES5 Error subclass has no reliable instanceof.
      const metadata=await pdf.getMetadata(),encrypted=typeof(metadata.info as {EncryptFilterName?:unknown}).EncryptFilterName==="string";
      if(encrypted){nativeFields=await extractReadOnlyNativeFields(pdf);issues.push({code:"ENCRYPTED_READ_ONLY",message:"暗号化されているため、読み取りだけを行います。",severity:"warning"});}
      else try{native=await PDFDocument.load(bytes.slice(),{updateMetadata:false});inspection=inspectNativeDocument(native);if(!inspection.xfa){const extraction=extractNativeFields(native);nativeFields=extraction.fields;issues.push(...extraction.issues);}for(let index=0;index<native.getPageCount();index++)issues.push(...inspectNativePageImages(native,index));issues.push(...inspection.issues);}catch{issues.push({code:"WRITER_UNSUPPORTED",message:"原書類の構造を安全に再保存できません。読み取りだけを行います。",severity:"error"});}
      const signatures=typeof pdf.getSignatures==="function"?await pdf.getSignatures():null;const signed=inspection?.signed||Boolean(signatures?.length);const xfa=inspection?.xfa||pdf.isPureXfa;const permissions=await pdf.getPermissions();const restricted=permissions!==null&&!permissions.has(lib.PermissionFlag.MODIFY_CONTENTS)&&!permissions.has(lib.PermissionFlag.FILL_INTERACTIVE_FORMS);
      const denied=encrypted?"暗号化 PDF は読み取り専用です。":signed?"電子署名のある PDF は読み取り専用です。":xfa?"XFA フォームは読み取り専用です。":restricted?"PDF の編集権限が制限されています。":issues.some(i=>i.code==="IMAGE_RESOURCE_LIMIT")?"画像が処理上限を超えるため、原本の表示と出力を検証できません。":!native||inspection?.unsupportedActive||issues.some(i=>i.severity==="error")?"原書類の構造を保って書き出せません。":null;
      const capabilities=capabilitySet(denied,nativeFields.length>0);if(inspection?.actionDependent)capabilities.nativeWrite={allowed:false,reason:"計算・検証処理があるため、編集可能フォームとして保存できません。"};
      const labels=await pdf.getPageLabels();const pages:PdfPageInfo[]=[];for(let index=0;index<pdf.numPages;index++){abortIfNeeded(options.signal);const page=await pdf.getPage(index+1);const viewport=page.getViewport({scale:1});const boxes=native?nativePageBoxes(native,index):{mediaBox:null,cropBox:null};pages.push({index,label:labels?.[index]??String(index+1),...boxes,visibleBox:[...page.view] as PdfBox,rotation:page.rotate as PdfPageInfo["rotation"],userUnit:page.userUnit,widthPt:viewport.width,heightPt:viewport.height,extraction:"unusable",review:"unseen"});}
      if(xfa)issues.push({code:"XFA_LAYOUT_DISABLED",message:"XFAの動的な画面は開きません。PDFに含まれる静的なページだけを確認できます。",severity:"warning"});const info:PdfDocumentInfo={id:crypto.randomUUID(),hash:await sha256(bytes),name:options.name??(source instanceof File?source.name:"書類.pdf"),byteLength:bytes.length,pageCount:pdf.numPages,pages,capabilities,issues,actionDependent:inspection?.actionDependent??false};options.onProgress?.({stage:"loading",completed:1,total:1});return new PdfSession(bytes,pdf,loading,assets,info,nativeFields);
    }catch(error){await loading.destroy();throw error;}
  }

  private ensureOpen():void{if(this.disposed)throw fail("SESSION_CLOSED","この PDF の作業は終了しています。");}
  private ownSignal(external?:AbortSignal):{signal:AbortSignal;release:()=>void}{const controller=new AbortController();const forward=()=>controller.abort(external?.reason);external?.addEventListener("abort",forward,{once:true});if(external?.aborted)controller.abort(external.reason);this.ownedControllers.add(controller);return {signal:controller.signal,release:()=>{external?.removeEventListener("abort",forward);this.ownedControllers.delete(controller);}};}
  getOriginalBytes():Uint8Array{this.ensureOpen();return this.original.slice();}
  getAnalysis():PdfAnalysis|null{return this.analysis?structuredClone(this.analysis):null;}
  getNativeConstraints():PdfNativeConstraints{this.ensureOpen();return{documentHash:this.originalHash,fields:this.nativeFields.filter(field=>field.native).map(field=>({name:field.native!.name,fieldRef:field.native!.fieldRef,referenceKind:field.native!.referenceKind??"field",originalReadOnly:field.native!.originalReadOnly??true,unsupported:field.native!.unsupported??true,initialValue:structuredClone(field.initialValue)}))};}

  /** Reopen only this live session's unmodified, successfully validated export. */
  async openValidatedOutput(result:PdfExportResult,options:PdfOpenOptions={}):Promise<PdfSession>{
    this.ensureOpen();abortIfNeeded(options.signal);const proof=validatedOutputs.get(this)?.get(result);
    if(!proof||!result.validated||result.hash!==proof.hash||result.originalHash!==proof.originalHash||proof.originalHash!==this.originalHash||result.bytes.byteLength!==proof.byteLength||result.pageCount!==proof.pageCount||result.mode!==proof.mode)throw fail("OUTPUT_PROVENANCE_MISMATCH","検証した書き出し結果と一致しません。PDF をもう一度作成してください。");
    if(proof.byteLength>PDF_MAX_OUTPUT_BYTES)throw fail("OUTPUT_BYTE_LIMIT","作成する PDF は 160MiB 以下にしてください。");
    // Copy before hashing: a caller changing its result during the async digest
    // cannot alter the verified bytes passed into the parser.
    const bytes=result.bytes.slice();const hash=await sha256(bytes);this.ensureOpen();abortIfNeeded(options.signal);if(hash!==proof.hash)throw fail("OUTPUT_PROVENANCE_MISMATCH","検証した書き出し結果と一致しません。PDF をもう一度作成してください。");
    const opened=await PdfSession.#openCore(bytes,{...options,assets:this.assets},PDF_MAX_OUTPUT_BYTES);try{this.ensureOpen();abortIfNeeded(options.signal);if(opened.info.hash!==proof.hash||opened.info.pageCount!==proof.pageCount)throw fail("OUTPUT_PROVENANCE_MISMATCH","検証した書き出し結果と一致しません。PDF をもう一度作成してください。");return opened;}catch(error){await opened.dispose();throw error;}
  }

  private async checkImageObjects(page:PDFPageProxy,list:Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>,signal:AbortSignal):Promise<void>{
    const {OPS}=await pdfJs(),ids=new Set<string>();for(let index=0;index<list.fnArray.length;index++){const fn=list.fnArray[index],args=list.argsArray[index];if(fn===OPS.paintImageXObject||fn===OPS.paintImageXObjectRepeat){if(typeof args[0]==="string")ids.add(args[0]);}else if(fn===OPS.paintImageMaskXObject&&typeof args[0]?.data==="string")ids.add(args[0].data);}
    for(const id of ids){const pool=id.startsWith("g_")?page.commonObjs:page.objs;const value=await abortable(new Promise<unknown>(resolve=>pool.get(id,resolve)),signal);if(value===null)throw fail("IMAGE_DECODE_FAILED","原本の画像を読み取れませんでした。このページは未解決です。再試行するか原本を別のビューアーで確認してください。");}
  }

  async render(pageIndex:number,canvas:PdfCanvas,options:PdfRenderOptions={}):Promise<PdfRenderResult>{
    this.ensureOpen();if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=this.info.pageCount)throw fail("PAGE_NOT_FOUND","指定したページがありません。");const owned=this.ownSignal(options.signal);
    let page:PDFPageProxy|null=null;try{page=await this.pdf.getPage(pageIndex+1);let scale=options.scale??1.5;if(!Number.isFinite(scale)||scale<=0)throw fail("INVALID_SCALE","拡大率が正しくありません。");let viewport=page.getViewport({scale});const limit=options.maxPixels??MAX_PIXELS;if(viewport.width*viewport.height>limit){scale*=Math.sqrt(limit/(viewport.width*viewport.height));viewport=page.getViewport({scale});}canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=context2d(canvas);const task=page.render({canvas:canvas as HTMLCanvasElement,canvasContext:context as CanvasRenderingContext2D,viewport,annotationMode:1,background:"white"});this.activeRenders.add(task);try{await abortable(task.promise,owned.signal,()=>task.cancel());}finally{this.activeRenders.delete(task);await task.promise.catch(()=>{});}const operators=await page.getOperatorList({annotationMode:1});await this.checkImageObjects(page,operators,owned.signal);return {width:canvas.width,height:canvas.height,pdfToViewport:viewport.transform as PdfAffine,viewportToPdf:inverse(viewport.transform as PdfAffine)};}finally{page?.cleanup();owned.release();}
  }

  private closePreviewDocument(document:PreviewDocument|null):void{
    if(!document)return;document.worker.destroy();void document.loading.destroy().catch(()=>{});
  }

  private previewFontBytes():Promise<Uint8Array>{
    if(this.previewFont)return this.previewFont;
    const controller=new AbortController();this.ownedControllers.add(controller);
    const pending=fetch(this.assets.japaneseFont,{signal:controller.signal,credentials:"omit",redirect:"error"}).then(async response=>{
      if(!response.ok)throw fail("FONT_UNAVAILABLE","日本語フォントを読み込めません。");
      const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<100)throw fail("FONT_UNAVAILABLE","日本語フォントを読み込めません。");
      if(this.disposed){bytes.fill(0);throw fail("SESSION_CLOSED","この PDF の作業は終了しています。");}return bytes;
    }).finally(()=>this.ownedControllers.delete(controller));
    this.previewFont=pending;void pending.catch(()=>{if(this.previewFont===pending)this.previewFont=null;});return pending;
  }

  /** Only unchanged source appearances can take the original-page fast path. */
  private previewIsOriginal(options:Pick<PdfPreviewRenderOptions,"fields"|"answers"|"answerStatus">):boolean{
    for(const field of options.fields){
      if(field.mappingState==="rejected")continue;
      const value=Object.hasOwn(options.answers,field.id)?options.answers[field.id]:field.initialValue;
      if(pdfFieldReadOnly(field)){
        const original=field.native?this.nativeFields.find(candidate=>candidate.native?.fieldRef===field.native!.fieldRef):field;
        if(!original||JSON.stringify(value)!==JSON.stringify(original.initialValue))return false;
        continue;
      }
      if(!pdfAnswerTypeCompatible(field,value))return false;
      if(field.native){
        const original=this.nativeFields.find(candidate=>candidate.native?.fieldRef===field.native!.fieldRef);
        if(!original||JSON.stringify(value)!==JSON.stringify(original.initialValue)||JSON.stringify(field.placements)!==JSON.stringify(original.placements)||field.kind!==original.kind||field.style)return false;
      }else if(value!==null&&value!==undefined&&value!==""&&value!==false&&(!Array.isArray(value)||value.length))return false;
    }return true;
  }

  /**
   * An unsaved visual draft, using the same writer as export. It never creates
   * a validated output, changes answers, or initiates a file download.
   */
  async renderPreview(pageIndex:number,canvas:PdfCanvas,options:PdfPreviewRenderOptions):Promise<PdfRenderResult>{
    this.ensureOpen();if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=this.info.pageCount)throw fail("PAGE_NOT_FOUND","指定したページがありません。");
    // Freeze mutable input before font loading, worker messages or PDF parsing.
    const snapshot=structuredClone({fields:options.fields,answers:options.answers,answerStatus:options.answerStatus,mode:options.mode??"overlay",actionRemovalConfirmed:options.actionRemovalConfirmed??false});
    const pages=exportPageSnapshot(this.info.pages,this.info.pageCount,options.pageReviews),owned=this.ownSignal(options.signal),controller=new AbortController();
    const forward=()=>controller.abort();owned.signal.addEventListener("abort",forward,{once:true});if(owned.signal.aborted)controller.abort();
    this.previewAbort?.abort();this.previewAbort=controller;const signal=controller.signal;
    try{
      abortIfNeeded(signal);
      if(!this.info.capabilities.export.allowed||this.info.actionDependent&&(snapshot.mode!=="print"||!snapshot.actionRemovalConfirmed)||!pages.some(page=>page.review==="excluded"||page.review==="no-inputs-confirmed")&&this.previewIsOriginal(snapshot))return await this.render(pageIndex,canvas,{...options,signal});
      if(this.failedImages.size)throw fail("IMAGE_DECODE_FAILED","読み取れない画像があるため、記入結果を表示できません。原本を確認してください。");
      const key=JSON.stringify({pages,...snapshot});let cached=this.previewDocument;
      if(cached?.key!==key){
        const fontBytes=await abortable(this.previewFontBytes(),signal);abortIfNeeded(signal);
        const input:BuildExportInput={...snapshot,inputMode:"direct",allowIncomplete:true,original:this.original.slice(),pages,fontBytes:fontBytes.slice()};
        let bytes:Uint8Array;
        if(typeof Worker!=="undefined"&&typeof window!=="undefined"){
          const worker=new Worker(new URL("../../workers/pdf/preview.worker.ts",import.meta.url),{type:"module"});this.activePreview=worker;
          const id=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>|undefined;
          try{bytes=await abortable(new Promise<Uint8Array>((resolve,reject)=>{
            const restart=()=>{clearTimeout(timer);timer=setTimeout(()=>reject(fail("PREVIEW_TIMEOUT","記入結果の表示に時間がかかっています。入力内容は保持されています。")),120_000);};restart();
            worker.onmessage=event=>{if(event.data.id!==id)return;if(event.data.kind==="progress"){restart();return;}if(event.data.ok)resolve(event.data.bytes);else reject(new PdfEngineError(event.data.error.code,event.data.error.message,event.data.error.issues));};
            worker.onerror=worker.onmessageerror=()=>reject(fail("PREVIEW_WORKER_FAILED","記入結果を表示できませんでした。入力内容は保持されています。"));
            worker.postMessage({id,input},[input.original.buffer as ArrayBuffer,input.fontBytes.buffer as ArrayBuffer]);
          }),signal,()=>worker.terminate());}finally{clearTimeout(timer);worker.terminate();if(this.activePreview===worker)this.activePreview=null;}
        }else bytes=(await buildPdfExport(input,signal)).bytes;
        abortIfNeeded(signal);this.ensureOpen();
        const lib=await abortable(pdfJs(),signal);abortIfNeeded(signal);
        const worker=new lib.PDFWorker();let loading:PDFDocumentLoadingTask|undefined,adopted=false;
        const cancel=()=>{worker.destroy();if(loading)void loading.destroy().catch(()=>{});};
        signal.addEventListener("abort",cancel,{once:true});
        try{
          loading=lib.getDocument({...localPdfDocumentParameters(this.assets),data:bytes,worker});
          const pdf=await abortable(loading.promise,signal,cancel);abortIfNeeded(signal);this.ensureOpen();
          if(pdf.numPages!==this.info.pageCount)throw fail("PREVIEW_PAGE_MISMATCH","記入結果のページ数を確認できません。");
          cached={key,pdf,loading,worker};const previous=this.previewDocument;this.previewDocument=cached;adopted=true;this.closePreviewDocument(previous);
        }finally{signal.removeEventListener("abort",cancel);if(!adopted)cancel();}
      }
      abortIfNeeded(signal);
      let page:PDFPageProxy|null=null;
      try{
        page=await abortable(cached.pdf.getPage(pageIndex+1),signal);abortIfNeeded(signal);
        let scale=options.scale??1.5;if(!Number.isFinite(scale)||scale<=0)throw fail("INVALID_SCALE","拡大率が正しくありません。");
        let viewport=page.getViewport({scale});const limit=options.maxPixels??MAX_PIXELS;if(viewport.width*viewport.height>limit){scale*=Math.sqrt(limit/(viewport.width*viewport.height));viewport=page.getViewport({scale});}
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const task=page.render({canvas:canvas as HTMLCanvasElement,canvasContext:context2d(canvas) as CanvasRenderingContext2D,viewport,annotationMode:1,background:"white"});this.activeRenders.add(task);
        try{await abortable(task.promise,signal,()=>task.cancel());}finally{this.activeRenders.delete(task);await task.promise.catch(()=>{});}
        const operators=await abortable(page.getOperatorList({annotationMode:1}),signal);await this.checkImageObjects(page,operators,signal);abortIfNeeded(signal);
        return{width:canvas.width,height:canvas.height,pdfToViewport:viewport.transform as PdfAffine,viewportToPdf:inverse(viewport.transform as PdfAffine)};
      }finally{page?.cleanup();}
    }finally{owned.signal.removeEventListener("abort",forward);owned.release();if(this.previewAbort===controller)this.previewAbort=null;}
  }

  async analyze(options:PdfAnalyzeOptions={}):Promise<PdfAnalysis>{
    this.ensureOpen();const timeoutMs=options.ocrTimeoutMs??90_000;if(timeoutMs!==90_000&&timeoutMs!==180_000)throw fail("INVALID_OCR_TIMEOUT","文字認識の待ち時間は90秒または180秒を選んでください。");const owned=this.ownSignal(options.signal),signal=owned.signal;const generation=++this.generation;const indices=[...new Set(options.pageIndices??this.info.pages.map(p=>p.index))];const selected=new Set(indices);const fields=[...structuredClone(this.nativeFields),...structuredClone(this.analysis?.fields.filter(f=>!f.native&&f.placements.every(p=>!selected.has(p.pageIndex)))??[])],evidence:PdfEvidence[]=structuredClone(this.analysis?.evidence.filter(e=>!selected.has(e.pageIndex))??[]),issues:PdfIssue[]=structuredClone(this.analysis?.issues.filter(i=>i.pageIndex!==undefined&&!selected.has(i.pageIndex))??[]);let completed=0;
    let jobOcr=this.ocr;
    const stopJobOcr=()=>{const current=jobOcr;if(current){void current.dispose();if(this.ocr===current)this.ocr=null;}};
    signal.addEventListener("abort",stopJobOcr,{once:true});
    if(signal.aborted)stopJobOcr();
    try{const lib=await pdfJs();for(const index of indices){abortIfNeeded(signal);if(!Number.isInteger(index)||index<0||index>=this.info.pageCount)throw fail("PAGE_NOT_FOUND","解析対象のページがありません。");options.onProgress?.({stage:"text",pageIndex:index,completed,total:indices.length});const pageStarted=performance.now();let page:PDFPageProxy|null=null;try{
        const preflight=this.info.issues.find(issue=>issue.pageIndex===index&&issue.code==="IMAGE_RESOURCE_LIMIT");if(preflight)throw new PdfEngineError(preflight.code,preflight.message);page=await this.pdf.getPage(index+1);const native=await page.getTextContent({disableNormalization:true});const localEvidence:PdfEvidence[]=[];
        for(const item of native.items){if(!("str" in item)||!item.str.trim())continue;const [a,b,,d,e,f]=item.transform;const height=Math.hypot(item.transform[2],d),length=Math.hypot(a,b)||1,ux=a/length,uy=b/length;const ascent=native.styles[item.fontName]?.ascent??.8,descent=native.styles[item.fontName]?.descent??-.2;const point=(x:number,y:number)=>({x:e+ux*x-uy*y,y:f+uy*x+ux*y});localEvidence.push({id:crypto.randomUUID(),pageIndex:index,text:item.str,quad:[point(0,height*descent),point(item.width,height*descent),point(item.width,height*ascent),point(0,height*ascent)],method:"native",rawOcrConfidence:null});}
        const operators=await page.getOperatorList({annotationMode:lib.AnnotationMode.DISABLE});await this.checkImageObjects(page,operators,signal);this.failedImages.delete(index);const geometry=inspectVectorGeometry(operators as unknown as Parameters<typeof inspectVectorGeometry>[0],lib.OPS,page.userUnit);page.cleanup();const vectorBoxes=[...geometry.boxes,...geometry.underlines],rasterQuads:PdfQuad[]=[];const textArea=localEvidence.reduce((sum,e)=>sum+area(quadToBox(e.quad)),0),pageArea=area(page.view as PdfBox);const imageArea=geometry.images.reduce((sum,b)=>sum+area(b),0);const corruptNative=localEvidence.some(e=>/[�\u0000-\u0008]/.test(e.text));const needOcr=options.ocr==="always"||options.ocr!=="never"&&(localEvidence.length===0||corruptNative||imageArea>pageArea*.025);let analysisRotation:0|90|180|270=0,analysisSkew=0;
        if(needOcr){abortIfNeeded(signal);const ocr=this.ocr??=new LocalOcr(this.assets);jobOcr=ocr;
          const recognizeTimed=async(canvas:PdfCanvas,imageToPdf:PdfAffine)=>{const timeout=new AbortController(),onCancel=()=>timeout.abort();signal.addEventListener("abort",onCancel,{once:true});if(signal.aborted)onCancel();const remainingMs=Math.max(0,timeoutMs-(performance.now()-pageStarted));if(!remainingMs)timeout.abort("timeout");const timer=setTimeout(()=>timeout.abort("timeout"),remainingMs);try{return await ocr.recognize(canvas,index,imageToPdf,{signal:timeout.signal,onProgress:options.onProgress});}catch(error){await ocr.dispose();if(this.ocr===ocr)this.ocr=null;if(signal.aborted)throw error;if(timeout.signal.aborted)throw fail("OCR_TIMEOUT",`このページの文字認識は${timeoutMs/1000}秒で完了しませんでした。再試行するか、未解析のまま保留できます。`);throw error;}finally{clearTimeout(timer);signal.removeEventListener("abort",onCancel);}};
          if(page.rotate===90||page.rotate===270){const raw=page.getViewport({scale:1,rotation:0}),sample=page.getViewport({scale:Math.min(1,700/Math.max(raw.width,raw.height)),rotation:0}),preview=createCanvas(sample.width,sample.height),previewContext=context2d(preview);const probe=page.render({canvas:preview as HTMLCanvasElement,canvasContext:previewContext as CanvasRenderingContext2D,viewport:sample,annotationMode:1,background:"white"});this.activeRenders.add(probe);try{await abortable(probe.promise,signal,()=>probe.cancel());analysisRotation=chooseAnalysisRotation(previewContext.getImageData(0,0,preview.width,preview.height).data,preview.width,preview.height,page.rotate);}finally{this.activeRenders.delete(probe);await probe.promise.catch(()=>{});preview.width=1;preview.height=1;}}
          // Select one basis for the entire page. Trial text is not added to the
          // analysis: every final tile, label and ordered writing quad uses the
          // same selected direction. Metadata alone cannot distinguish an
          // upright raw scan from a scan whose pixels require that rotation.
          const rawProbe=page.getViewport({scale:1,rotation:analysisRotation}),probeViewport=page.getViewport({scale:Math.min(150/72,1800/Math.max(rawProbe.width,rawProbe.height)),rotation:analysisRotation}),directionCanvas=createCanvas(probeViewport.width,probeViewport.height),directionTask=page.render({canvas:directionCanvas as HTMLCanvasElement,canvasContext:context2d(directionCanvas) as CanvasRenderingContext2D,viewport:probeViewport,annotationMode:1,background:"white"});this.activeRenders.add(directionTask);
          try{await abortable(directionTask.promise,signal,()=>directionTask.cancel());const initialRotation=analysisRotation,pageUnit=page.userUnit,estimationMasks=[...this.nativeFields.flatMap(f=>[...f.placements,...f.options.flatMap(o=>o.placements)]).filter(p=>p.pageIndex===index).map(p=>p.quad),...vectorBoxes.filter(b=>b[2]-b[0]<=720/pageUnit&&b[3]-b[1]<=260/pageUnit).map(rectToQuad)].map(q=>quadToBox(transformQuad(probeViewport.transform as PdfAffine,q))),corrected=deskew(directionCanvas,inverse(probeViewport.transform as PdfAffine),undefined,estimationMasks);try{analysisSkew=corrected.angle;let best=await recognizeTimed(corrected.canvas,corrected.imageToPdf);const turns: Array<90|180|270>=page.rotate===90||page.rotate===270?[180,90,270]:[180];for(const turn of turns){abortIfNeeded(signal);const alternative=rotateAnalysisCanvas(corrected.canvas,corrected.imageToPdf,turn);try{const trial=await recognizeTimed(alternative.canvas,alternative.imageToPdf);if(preferOppositeOcr(best,trial)){best=trial;analysisRotation=(initialRotation+turn)%360 as 0|90|180|270;}}finally{alternative.canvas.width=1;alternative.canvas.height=1;}}}finally{if(corrected.canvas!==directionCanvas){corrected.canvas.width=1;corrected.canvas.height=1;}}}finally{this.activeRenders.delete(directionTask);await directionTask.promise.catch(()=>{});directionCanvas.width=1;directionCanvas.height=1;}
          const viewport=page.getViewport({scale:300/72,rotation:analysisRotation});const tileSide=3200,overlap=64;let tiles=0;for(let y=0;y<viewport.height;y+=tileSide-overlap)for(let x=0;x<viewport.width;x+=tileSide-overlap){abortIfNeeded(signal);if(performance.now()-pageStarted>=timeoutMs){await ocr.dispose();if(this.ocr===ocr)this.ocr=null;throw fail("OCR_TIMEOUT",`このページの文字認識は${timeoutMs/1000}秒で完了しませんでした。再試行するか、未解析のまま保留できます。`);}const width=Math.min(tileSide,viewport.width-x),height=Math.min(tileSide,viewport.height-y);if(++tiles>128)throw fail("IMAGE_LIMIT","ページの画像が処理上限を超えています。");const canvas=createCanvas(width,height),context=context2d(canvas);const task=page.render({canvas:canvas as HTMLCanvasElement,canvasContext:context as CanvasRenderingContext2D,viewport,transform:[1,0,0,1,-x,-y],annotationMode:1,background:"white"});this.activeRenders.add(task);try{await abortable(task.promise,signal,()=>task.cancel());}finally{this.activeRenders.delete(task);await task.promise.catch(()=>{});}
            page.cleanup();const pixelToPdf=multiply(inverse(viewport.transform as PdfAffine),[1,0,0,1,x,y]);const corrected=deskew(canvas,pixelToPdf,analysisSkew);const rasterBoxes=detectRasterBoxes(context2d(corrected.canvas).getImageData(0,0,corrected.canvas.width,corrected.canvas.height).data,corrected.canvas.width,corrected.canvas.height);rasterQuads.push(...rasterBoxes.map(b=>transformQuad(corrected.imageToPdf,rectToQuad(b))));
            try{localEvidence.push(...await recognizeTimed(corrected.canvas,corrected.imageToPdf));}finally{canvas.width=1;canvas.height=1;if(corrected.canvas!==canvas){corrected.canvas.width=1;corrected.canvas.height=1;}}
          }}
        this.info.pages[index].extraction=needOcr?(native.items.length?"mixed":"image"):"native";const merged=mergeTextEvidence(localEvidence);evidence.push(...merged);options.onProgress?.({stage:"structure",pageIndex:index,completed,total:indices.length});fields.push(...inferFields(index,vectorBoxes,merged,fields,page.userUnit,analysisRotation));if(rasterQuads.length)fields.push(...inferFields(index,rasterQuads,merged,fields,page.userUnit,analysisRotation+analysisSkew*180/Math.PI));
        for(const field of fields.filter(f=>f.native&&f.placements.some(p=>p.pageIndex===index))){if(field.labelOriginal===field.native!.name&&/^(?:text|field|check|radio|undefined|欄)[\s_\d.-]*$/i.test(field.label)){const first=field.placements.find(p=>p.pageIndex===index)!;const b=quadToBox(first.quad);const nearest=merged.filter(e=>{const q=quadToBox(e.quad);return q[2]<=b[0]+4&&Math.abs((q[1]+q[3]-b[1]-b[3])/2)<25&&b[0]-q[2]<180;}).sort((a,b2)=>quadToBox(b2.quad)[2]-quadToBox(a.quad)[2])[0];if(nearest){field.label=nearest.text;field.labelOriginal=nearest.text;field.evidenceIds=[nearest.id];const classified=classifyLabel(nearest.text);field.role=classified.role;field.description=classified.description;field.readOnly=field.readOnly||classified.role==="office"||classified.role==="signature";}}}
        if(fields.length>5000)throw fail("FIELD_LIMIT","項目数が 5,000 を超えています。このページは未解決として残します。");
      }catch(error){if(signal.aborted)throw error;if(error instanceof PdfEngineError&&error.code==="IMAGE_DECODE_FAILED")this.failedImages.add(index);this.info.pages[index].extraction="unusable";issues.push({code:error instanceof PdfEngineError?error.code:"PAGE_ANALYSIS_FAILED",message:error instanceof PdfEngineError?error.message:"このページの解析に失敗しました。原本を見ながら項目を追加するか、再試行してください。",pageIndex:index,severity:"warning"});}finally{page?.cleanup();}completed++;if(generation===this.generation)this.analysis=structuredClone({document:this.info,fields,evidence,issues,complete:false});options.onProgress?.({stage:"structure",pageIndex:index,completed,total:indices.length});}
      abortIfNeeded(signal);if(generation!==this.generation)throw new DOMException("新しい解析に置き換えられました。","AbortError");const result:PdfAnalysis={document:this.info,fields,evidence,issues,complete:this.info.pages.every(p=>p.extraction!=="unusable")&&issues.length===0};this.analysis=structuredClone(result);return structuredClone(result);
    }finally{signal.removeEventListener("abort",stopJobOcr);if(signal.aborted)stopJobOcr();owned.release();}
  }

  async export(options:PdfExportOptions):Promise<PdfExportResult>{
    this.ensureOpen();if(!this.info.capabilities.export.allowed)throw fail("DOCUMENT_READ_ONLY",this.info.capabilities.export.reason??"この PDF は読み取り専用です。");if(this.failedImages.size)throw fail("IMAGE_DECODE_FAILED","読み取れない画像があるため、出力を検証できません。該当ページを再試行してください。");const pages=exportPageSnapshot(this.info.pages,this.info.pageCount,options.pageReviews),owned=this.ownSignal(options.signal),signal=owned.signal;const mode=options.mode??"overlay";
    try{abortIfNeeded(signal);options.onProgress?.({stage:"export",completed:0,total:1});const fontBytes=options.fontBytes??new Uint8Array(await (await fetch(this.assets.japaneseFont,{signal})).arrayBuffer());if(fontBytes.length<100)throw fail("FONT_UNAVAILABLE","日本語フォントを読み込めません。");const input:BuildExportInput={original:this.original.slice(),pages,fields:structuredClone(options.fields),answers:structuredClone(options.answers),answerStatus:options.answerStatus?{...options.answerStatus}:undefined,inputMode:options.inputMode,mode,fontBytes:fontBytes.slice(),allowIncomplete:options.allowIncomplete??false,actionRemovalConfirmed:options.actionRemovalConfirmed??false};let result:BuildExportResult;
      if(typeof Worker!=="undefined"&&typeof window!=="undefined"){
        if(this.activeExport)throw fail("EXPORT_BUSY","PDF を作成中です。完了または取消の後に再試行してください。");const worker=new Worker(new URL("../../workers/pdf/export.worker.ts",import.meta.url),{type:"module"});this.activeExport=worker;const id=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>;
        try{result=await abortable(new Promise<BuildExportResult>((resolve,reject)=>{
          const restartTimeout=()=>{clearTimeout(timer);timer=setTimeout(()=>reject(fail("EXPORT_TIMEOUT","PDFの作成が時間内に進みませんでした。記入内容を保持したまま再試行できます。")),120_000);};restartTimeout();
          worker.onmessage=event=>{if(event.data.id!==id)return;if(event.data.kind==="progress"){restartTimeout();options.onProgress?.({stage:"export",completed:event.data.completed,total:event.data.total,detail:event.data.detail});return;}if(event.data.ok)resolve(event.data.result);else reject(new PdfEngineError(event.data.error.code,event.data.error.message,event.data.error.issues));};
          worker.onerror=worker.onmessageerror=()=>reject(fail("EXPORT_WORKER_FAILED","PDF の作成処理が停止しました。再試行できます。"));worker.postMessage({id,input},[input.original.buffer as ArrayBuffer,input.fontBytes.buffer as ArrayBuffer]);
        }),signal,()=>worker.terminate());}finally{clearTimeout(timer!);worker.terminate();this.activeExport=null;}
      }
      else result=await buildPdfExport(input,signal);
      options.onProgress?.({stage:"export",completed:1,total:1});options.onProgress?.({stage:"validation",completed:0,total:1});await this.validateOutput(result,mode,signal,options.fields);abortIfNeeded(signal);const hash=await sha256(result.bytes);this.ensureOpen();abortIfNeeded(signal);const exported:PdfExportResult={bytes:result.bytes,hash,issues:result.issues,validated:true,mode,originalHash:this.originalHash,pageCount:this.info.pageCount};let registry=validatedOutputs.get(this);if(!registry){registry=new WeakMap();validatedOutputs.set(this,registry);}registry.set(exported,Object.freeze({hash,originalHash:this.originalHash,byteLength:result.bytes.byteLength,pageCount:this.info.pageCount,mode}));options.onProgress?.({stage:"validation",completed:1,total:1});return exported;
    }finally{owned.release();}
  }

  private async validateOutput(result:BuildExportResult,mode:NonNullable<PdfExportOptions["mode"]>,signal:AbortSignal,fields:PdfField[]):Promise<void>{
    if(result.bytes.byteLength>PDF_MAX_OUTPUT_BYTES)throw fail("OUTPUT_BYTE_LIMIT","作成する PDF は 160MiB 以下にしてください。");
    const lib=await abortable(pdfJs(),signal);abortIfNeeded(signal);
    // This parser has an independent lifetime from the original document. Own
    // its public worker so cancellation never waits for a stalled Terminate reply.
    const worker=new lib.PDFWorker();let workerDestroyed=false,loading:PDFDocumentLoadingTask|undefined,cleanup:Promise<void>|undefined;
    const destroyWorker=()=>{if(workerDestroyed)return;workerDestroyed=true;worker.destroy();};
    const destroyOnce=()=>{if(!loading)return Promise.resolve();if(!cleanup){try{cleanup=loading.destroy();}catch(error){cleanup=Promise.reject(error);}void cleanup.catch(()=>{});}return cleanup;};
    const cancelValidation=()=>{destroyWorker();void destroyOnce().catch(()=>{});};
    signal.addEventListener("abort",cancelValidation,{once:true});
    try{abortIfNeeded(signal);loading=lib.getDocument({...localPdfDocumentParameters(this.assets),data:result.bytes.slice(),worker});if(signal.aborted)cancelValidation();const output=await abortable(loading.promise,signal,cancelValidation);if(output.numPages!==this.info.pageCount)throw fail("OUTPUT_PAGE_MISMATCH","作成した PDF のページ数が原本と一致しません。");
      const native=await abortable(PDFDocument.load(result.bytes.slice(),{updateMetadata:false}),signal,cancelValidation);abortIfNeeded(signal);const inspection=inspectNativeDocument(native);if(inspection.activeActions||inspection.unsupportedActive||inspection.actionDependent)throw fail("OUTPUT_ACTIVE_CONTENT","作成した PDF に除去できていない処理があります。");
      for(let i=0;i<output.numPages;i++){abortIfNeeded(signal);const page=await abortable(output.getPage(i+1),signal,cancelValidation),original=this.info.pages[i],boxes=nativePageBoxes(native,i);if(page.rotate!==original.rotation||Math.abs(page.userUnit-original.userUnit)>1e-8||page.view.some((value,j)=>Math.abs(value-original.visibleBox[j])>.01)||original.mediaBox&&boxes.mediaBox.some((value,j)=>Math.abs(value-original.mediaBox![j])>.01)||original.cropBox&&boxes.cropBox.some((value,j)=>Math.abs(value-original.cropBox![j])>.01))throw fail("OUTPUT_GEOMETRY_MISMATCH","作成した PDF の用紙や回転が原本と一致しません。");await abortable(page.getTextContent({disableNormalization:true}),signal,cancelValidation);
        if(typeof document!=="undefined"||typeof OffscreenCanvas!=="undefined")await this.validateRenderedPage(page,i,result,fields,signal);
      }
      if(mode!=="print"){const fields=native.getForm().getFields();for(const item of result.written.filter(w=>w.nativeName)){
        const field=fields.find(f=>f.getName()===item.nativeName);if(!field)throw fail("OUTPUT_FIELD_MISMATCH","保存した入力欄が見つかりません。");const object=field as unknown as {getText?:()=>string|undefined;isChecked?:()=>boolean;getSelected?:()=>string|string[]|undefined};let actual=object.getText?object.getText()??"":object.isChecked?object.isChecked():object.getSelected?.()??null;let expected=item.value;
        if(object.getText&&expected===null)expected="";else if(object.getSelected&&(expected===null||expected===""))expected=Array.isArray(actual)?[]:null;
        if(Array.isArray(actual)&&Array.isArray(expected)){actual=[...actual].sort();expected=[...expected].sort();}
        if(Array.isArray(actual)&&typeof expected==="string"){if(actual.length!==1||actual[0]!==expected)throw fail("OUTPUT_VALUE_MISMATCH","作成した PDF の選択値が回答と一致しません。");}else if(JSON.stringify(actual)!==JSON.stringify(expected))throw fail("OUTPUT_VALUE_MISMATCH","作成した PDF の値が回答と一致しません。");
      }}
    }finally{try{const closing=destroyOnce();if(!signal.aborted)await abortable(closing,signal,cancelValidation);}finally{signal.removeEventListener("abort",cancelValidation);destroyWorker();}}
  }

  private async validateRenderedPage(outputPage:PDFPageProxy,pageIndex:number,result:BuildExportResult,fields:PdfField[],signal:AbortSignal):Promise<void>{
    const originalPage=await abortable(this.pdf.getPage(pageIndex+1),signal);let scale=1.5;const raw=originalPage.getViewport({scale});if(raw.width*raw.height>MAX_PIXELS)scale*=Math.sqrt(MAX_PIXELS/(raw.width*raw.height));const viewport=originalPage.getViewport({scale});const originalCanvas=createCanvas(viewport.width,viewport.height),outputCanvas=createCanvas(viewport.width,viewport.height);
    try{for(const [page,canvas]of [[originalPage,originalCanvas],[outputPage,outputCanvas]] as const){const task=page.render({canvas:canvas as HTMLCanvasElement,canvasContext:context2d(canvas) as CanvasRenderingContext2D,viewport:page.getViewport({scale}),annotationMode:1,background:"white"});this.activeRenders.add(task);try{await abortable(task.promise,signal,()=>task.cancel());}finally{this.activeRenders.delete(task);await task.promise.catch(()=>{});}await this.checkImageObjects(page,await abortable(page.getOperatorList({annotationMode:1}),signal),signal);}
      const writtenIds=new Set(result.written.map(w=>w.fieldId));const modified=fields.filter(f=>writtenIds.has(f.id));const placements=modified.flatMap(f=>[...f.placements,...f.options.flatMap(o=>o.placements),...(f.native?this.nativeFields.find(n=>n.native?.fieldRef===f.native!.fieldRef)?.placements??[]:[])]).filter(p=>p.pageIndex===pageIndex);const masks=placements.map(p=>{const b=quadToBox(transformQuad(viewport.transform as PdfAffine,p.quad)),padding=4*scale;return [b[0]-padding,b[1]-padding,b[2]+padding,b[3]+padding] as PdfBox;});
      const maskCanvas=createCanvas(originalCanvas.width,originalCanvas.height),maskContext=context2d(maskCanvas);maskContext.fillStyle="#000";for(const box of masks)maskContext.fillRect(Math.floor(box[0]),Math.floor(box[1]),Math.ceil(box[2])-Math.floor(box[0])+1,Math.ceil(box[3])-Math.floor(box[1])+1);const mask=maskContext.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;maskCanvas.width=1;maskCanvas.height=1;
      const before=context2d(originalCanvas).getImageData(0,0,originalCanvas.width,originalCanvas.height).data,after=context2d(outputCanvas).getImageData(0,0,outputCanvas.width,outputCanvas.height).data;let compared=0,changed=0;
      for(let y=0;y<originalCanvas.height;y+=2){if(y%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));abortIfNeeded(signal);for(let x=0;x<originalCanvas.width;x+=2){const pixel=(y*originalCanvas.width+x)*4;if(mask[pixel+3])continue;compared++;if(Math.max(Math.abs(before[pixel]-after[pixel]),Math.abs(before[pixel+1]-after[pixel+1]),Math.abs(before[pixel+2]-after[pixel+2]))>32)changed++;}}
      if(changed>Math.max(20,compared*.0005))throw new PdfEngineError("OUTPUT_UNEXPECTED_VISUAL_CHANGE","記入欄以外の表示が原本から変わりました。書き出しを中止しました。",[{code:"OUTPUT_UNEXPECTED_VISUAL_CHANGE",message:"本文または画像の差分を確認してください。",pageIndex,severity:"error"}]);
    }finally{originalCanvas.width=1;originalCanvas.height=1;outputCanvas.width=1;outputCanvas.height=1;originalPage.cleanup();outputPage.cleanup();}
  }

  async dispose():Promise<void>{if(this.disposed)return;this.disposed=true;++this.generation;this.previewAbort?.abort();this.previewAbort=null;for(const controller of this.ownedControllers)controller.abort();this.ownedControllers.clear();for(const task of this.activeRenders)task.cancel();this.activeRenders.clear();this.activeExport?.terminate();this.activeExport=null;this.activePreview?.terminate();this.activePreview=null;this.closePreviewDocument(this.previewDocument);this.previewDocument=null;const font=this.previewFont;this.previewFont=null;if(font)void font.then(bytes=>bytes.fill(0)).catch(()=>{});await this.ocr?.dispose();this.ocr=null;await this.loading.destroy();this.original=new Uint8Array();this.nativeFields=[];this.analysis=null;}
}





