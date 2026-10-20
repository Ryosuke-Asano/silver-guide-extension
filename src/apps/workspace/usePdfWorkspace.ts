import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { PdfSession } from "../../adapters/pdf";
import { PdfEngineError,pdfFieldPageIndices,pdfFieldReadOnly,quadToBox, type PdfAnalysis, type PdfExportResult, type PdfField, type PdfProgress,type PdfNativeConstraints,type PdfDocumentInfo } from "../../domain/pdf";
import { getWebExtensionApi } from "../../shared/webextension";
import { createPdfTask, getPdfTaskIssues,getDirectPdfTaskIssues,hydratePdfFieldsNativeConstraints,snapshotPdfMapping, updatePdfTask, type PdfTask } from "./task-model";

export type PdfWorkspaceState = "empty" | "loading" | "analyzing" | "ready" | "exporting" | "validating" | "downloading" | "cancelled" | "failed";
// Binary PDF data belongs to the resource ref. Passing millions of typed-array
// entries through component props also stalls React's development render logger.
export type PdfWorkspaceOutput = Omit<PdfExportResult,"bytes"> & {byteLength:number};
export type PdfPasswordRequest = { requestId: string; reason: "required" | "incorrect"; message: string };
export type PdfReanalysisChange = { id: string; kind: "added" | "changed" | "removed"; previous?: PdfField; candidate?: PdfField; protected: boolean };
export type PdfReanalysisDiff = { taskId: string; baseRevision: number; pageIndices: number[]; changes: PdfReanalysisChange[]; analysis: PdfAnalysis };

export function hydratePdfReanalysisConstraints(diff:PdfReanalysisDiff,constraints:PdfNativeConstraints,source:Pick<PdfDocumentInfo,"hash"|"capabilities"|"actionDependent"|"issues">):PdfReanalysisDiff{
  if(diff.analysis.document.hash!==constraints.documentHash||source.hash!==constraints.documentHash)return diff;
  const next=structuredClone(diff),fields=[...next.analysis.fields],slots:Array<{change:PdfReanalysisChange;key:"previous"|"candidate";index:number}>=[];
  for(const change of next.changes)for(const key of ["previous","candidate"]as const)if(change[key]){slots.push({change,key,index:fields.length});fields.push(change[key]!);}
  const hydrated=hydratePdfFieldsNativeConstraints(fields,constraints,source.hash);next.analysis.fields=hydrated.slice(0,next.analysis.fields.length);for(const slot of slots)slot.change[slot.key]=hydrated[slot.index];
  next.analysis.document.capabilities=structuredClone(source.capabilities);next.analysis.document.actionDependent=source.actionDependent;next.analysis.document.issues=structuredClone(source.issues);return next;
}

export function checkpointPdfAnalysis(source:PdfAnalysis):PdfAnalysis {
  const analysis=structuredClone(source);analysis.complete=false;
  for(const page of analysis.document.pages.filter(page=>page.extraction==="unusable"))if(!analysis.issues.some(issue=>issue.pageIndex===page.index))analysis.issues.push({code:"ANALYSIS_CANCELLED_PAGE",message:"このページの解析は完了していません。再試行できます。",pageIndex:page.index,severity:"warning"});
  return analysis;
}

function similarity(a: PdfField, b: PdfField): number {
  const p=a.placements[0],q=b.placements[0]; if(!p||!q||p.pageIndex!==q.pageIndex)return 0;
  const x=quadToBox(p.quad),y=quadToBox(q.quad),area=(r:number[])=>Math.max(0,r[2]-r[0])*Math.max(0,r[3]-r[1]);
  const intersection=area([Math.max(x[0],y[0]),Math.max(x[1],y[1]),Math.min(x[2],y[2]),Math.min(x[3],y[3])]);
  return intersection/(area(x)+area(y)-intersection||1);
}
export function buildPdfReanalysisDiff(task:PdfTask,analysis:PdfAnalysis,pageIndices:number[]):PdfReanalysisDiff {
  const pages=new Set(pageIndices),previous=task.fields.filter(f=>pdfFieldPageIndices(f).some(index=>pages.has(index))),matched=new Set<string>(),changes:PdfReanalysisChange[]=[];
  const protectedField=(field:PdfField)=>field.source==="manual"||["confirmed","manual","rejected"].includes(field.mappingState)||!!field.templateBinding||task.answerStatus[field.id]==="entered";
  for(const candidate of analysis.fields.filter(f=>pdfFieldPageIndices(f).some(index=>pages.has(index)))) {
    const old=candidate.native?previous.find(f=>f.native?.fieldRef===candidate.native!.fieldRef):previous.filter(f=>!f.native&&!matched.has(f.id)).sort((a,b)=>similarity(b,candidate)-similarity(a,candidate)).find(f=>similarity(f,candidate)>.55);
    if(!old){changes.push({id:crypto.randomUUID(),kind:"added",candidate,protected:false});continue;}matched.add(old.id);
    if(old.label!==candidate.label||old.kind!==candidate.kind||old.role!==candidate.role||old.required!==candidate.required||JSON.stringify(old.placements)!==JSON.stringify(candidate.placements)||JSON.stringify(old.options)!==JSON.stringify(candidate.options))
      changes.push({id:crypto.randomUUID(),kind:"changed",previous:old,candidate:{...candidate,id:old.id},protected:protectedField(old)});
  }
  for(const old of previous)if(!matched.has(old.id))changes.push({id:crypto.randomUUID(),kind:"removed",previous:old,protected:protectedField(old)});
  return {taskId:task.id,baseRevision:task.revision,pageIndices,changes,analysis};
}

/** Accept extracted facts without undoing the person's explicit exclusions. */
export function planPdfReanalysisAdoption(current:PdfTask,diff:PdfReanalysisDiff,changeIds:readonly string[]):{update:Partial<PdfTask>|null;reason:string|null}{
  if(current.id!==diff.taskId||current.revision!==diff.baseRevision)return{update:null,reason:"作業が変更されたため、再解析をやり直してください。"};
  const selected=new Set(changeIds),excludedPages=new Set(current.pages.filter(page=>["excluded","no-inputs-confirmed"].includes(page.review)).map(page=>page.index));
  let fields=structuredClone(current.fields);const answers=structuredClone(current.answers),answerStatus={...current.answerStatus};
  for(const change of diff.changes){if(!selected.has(change.id))continue;
    if(change.kind==="added"&&change.candidate){
      if(fields.length>=5000||fields.some(field=>field.id===change.candidate!.id))return{update:null,reason:"差分の採用後は5000件以内で、項目の識別子が重ならない必要があります。追加候補を少なく選んでください。現在の対応と回答は保持しています。"};
      const candidate=structuredClone(change.candidate);if(pdfFieldPageIndices(candidate).some(index=>excludedPages.has(index)))candidate.mappingState="rejected";
      fields.push(candidate);answers[candidate.id]=structuredClone(candidate.initialValue);answerStatus[candidate.id]="empty";
    }else if(change.kind==="changed"&&change.candidate&&change.previous){
      fields=fields.map(field=>field.id===change.previous!.id?{...structuredClone(change.candidate!),id:field.id,revision:field.revision+1,mappingState:field.mappingState==="rejected"?"rejected":"needs-review",...(field.templateBinding?{templateBinding:structuredClone(field.templateBinding)}:{})}:field);
      if(answers[change.previous.id]!==null&&answers[change.previous.id]!=="")answerStatus[change.previous.id]="needs-review";
    }else if(change.kind==="removed"&&change.previous)fields=fields.map(field=>field.id===change.previous!.id?{...field,revision:field.revision+1,mappingState:"rejected"}:field);
  }
  const selectedPages=new Set(diff.pageIndices),pages=current.pages.map(page=>selectedPages.has(page.index)?{...page,extraction:diff.analysis.document.pages[page.index].extraction,review:page.review==="excluded"?"excluded" as const:"unseen" as const}:page);
  const selectedFieldId=fields.some(field=>field.id===current.selectedFieldId&&field.mappingState!=="rejected")?current.selectedFieldId:fields.find(field=>field.mappingState!=="rejected")?.id??null;
  return{update:{fields,answers,answerStatus,pages,analysis:structuredClone(diff.analysis),stage:"mapping",selectedFieldId,mappingHistory:[...(current.mappingHistory??[]),snapshotPdfMapping(current)].slice(-20),mappingRedo:[]},reason:null};
}
type DownloadsApi=NonNullable<ReturnType<typeof getWebExtensionApi>>["downloads"];
export function watchPdfDownload(api:DownloadsApi,id:number,options:{signal?:AbortSignal;timeoutMs?:number;onComplete:()=>void;onError:(message:string)=>void;onCancel?:()=>void;onCleanup?:()=>void}):()=>void {
  let finished=false;let timer:ReturnType<typeof setTimeout>;
  const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timer);api.onChanged.removeListener(changed);options.signal?.removeEventListener("abort",abort);options.onCleanup?.();};
  const complete=()=>{if(finished)return;cleanup();options.onComplete();};
  const fail=(message:string)=>{if(finished)return;cleanup();options.onError(message);};
  const cancelled=()=>{if(finished)return;cleanup();if(options.onCancel)options.onCancel();else options.onError("保存を中止しました。検証済みPDFは保持されています。");};
  const changed=(delta:browser.downloads._OnChangedDownloadDelta)=>{if(delta.id!==id)return;if(delta.state?.current==="complete")complete();else if(delta.error?.current==="USER_CANCELED")cancelled();else if(delta.state?.current==="interrupted"||delta.error?.current)fail("ファイルの保存が中断されました。検証済みPDFは保持されています。");};
  const abort=()=>cleanup();
  api.onChanged.addListener(changed);options.signal?.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>fail("保存の完了を確認できませんでした。ブラウザーのダウンロード一覧を確認してください。"),options.timeoutMs??300_000);
  if(options.signal?.aborted){cleanup();return cleanup;}
  void Promise.resolve().then(()=>api.search({id})).then(items=>{if(finished)return;if(items[0]?.state==="complete")complete();else if(items[0]?.error==="USER_CANCELED")cancelled();else if(items[0]?.state==="interrupted")fail("ファイルの保存が中断されました。検証済みPDFは保持されています。");}).catch(()=>fail("保存の状態を確認できませんでした。ブラウザーのダウンロード一覧を確認してください。"));
  return cleanup;
}

export function usePdfWorkspace() {
  const [task,setTaskState]=useState<PdfTask|null>(null),[state,setState]=useState<PdfWorkspaceState>("empty");
  const [progress,setProgress]=useState<PdfProgress|null>(null),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const [output,setOutputState]=useState<PdfWorkspaceOutput|null>(null),[outputConfirmed,setOutputConfirmed]=useState(false);
  const [passwordRequest,setPasswordRequest]=useState<PdfPasswordRequest|null>(null),[reanalysisDiff,setReanalysisDiff]=useState<PdfReanalysisDiff|null>(null);
  const session=useRef<PdfSession|null>(null),outputSession=useRef<PdfSession|null>(null),original=useRef<Uint8Array|null>(null),controller=useRef<AbortController|null>(null);
  const generation=useRef(0),taskRef=useRef<PdfTask|null>(null),mounted=useRef(true);
  const outputRef=useRef<{result:PdfExportResult;taskId:string;revision:number;inputMode?:"direct"}|null>(null);
  const passwordResolver=useRef<((value:string|null)=>void)|null>(null),downloadCleanup=useRef<(()=>void)|null>(null);
  // A replacement is parsed separately; failed or cancelled reads keep the
  // current document, answers and preview available.
  const pending=useRef<{session:PdfSession|null;bytes:Uint8Array|null}|null>(null);
  const commitTask=useCallback((next:PdfTask|null)=>{taskRef.current=next;if(mounted.current)setTaskState(next);},[]);
  const clearOutput=useCallback(()=>{const previous=outputSession.current;outputSession.current=null;outputRef.current=null;if(mounted.current){setOutputState(null);setOutputConfirmed(false);}void previous?.dispose();},[]);
  const invalidateJob=useCallback(()=>{generation.current++;controller.current?.abort();controller.current=null;downloadCleanup.current?.();downloadCleanup.current=null;passwordResolver.current?.(null);passwordResolver.current=null;if(mounted.current)setPasswordRequest(null);},[]);
  const releaseResources=useCallback(async()=>{
    invalidateJob();
    const reading=session.current,preview=outputSession.current,candidate=pending.current;
    session.current=null;outputSession.current=null;pending.current=null;
    original.current?.fill(0);original.current=null;candidate?.bytes?.fill(0);
    outputRef.current=null;
    await Promise.allSettled([reading?.dispose(),preview?.dispose(),candidate?.session?.dispose()]);
  },[invalidateJob]);
  const dispose=useCallback(async()=>{
    commitTask(null);clearOutput();
    if(mounted.current){setState("empty");setProgress(null);setPasswordRequest(null);setReanalysisDiff(null);}
    await releaseResources();
  },[commitTask,clearOutput,releaseResources]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void releaseResources();};},[releaseResources]);
  const setTask=useCallback((next:SetStateAction<PdfTask|null>)=>{
    const previous=taskRef.current,value=typeof next==="function"?next(previous):next;
    if(previous?.id!==value?.id||previous?.revision!==value?.revision){invalidateJob();clearOutput();setReanalysisDiff(null);if(mounted.current)setState(value?"ready":"empty");}
    commitTask(value);
  },[commitTask,invalidateJob,clearOutput]);
  const update=useCallback((mutate:(current:PdfTask)=>Partial<PdfTask>)=>{
    const current=taskRef.current;if(!current)return;
    const next=updatePdfTask(current,mutate(current));
    if(next.id!==current.id||next.revision!==current.revision){invalidateJob();clearOutput();setReanalysisDiff(null);setState("ready");}
    commitTask(next);setError(null);
  },[commitTask,invalidateJob,clearOutput]);
  const providePassword=useCallback((value:string|null)=>{const resolve=passwordResolver.current;passwordResolver.current=null;setPasswordRequest(null);if(value===null){invalidateJob();setState(taskRef.current?"ready":"cancelled");setNotice("パスワードの入力を中止しました。");}resolve?.(value);},[invalidateJob]);

  const open=useCallback(async(input:Blob|Uint8Array,name:string):Promise<boolean>=>{
    invalidateJob();clearOutput();setState("loading");setError(null);setNotice(null);setProgress(null);setReanalysisDiff(null);
    const previousCandidate=pending.current;
    pending.current=null;previousCandidate?.bytes?.fill(0);void previousCandidate?.session?.dispose();
    const token=generation.current,abort=new AbortController();controller.current=abort;
    const candidate:{session:PdfSession|null;bytes:Uint8Array|null}={session:null,bytes:null};pending.current=candidate;
    const live=()=>mounted.current&&token===generation.current&&!abort.signal.aborted;
    try {
      const bytes=input instanceof Uint8Array?input.slice():new Uint8Array(await input.arrayBuffer());candidate.bytes=bytes;
      if(!live())return false;
      const {PdfSession:Engine}=await import("../../adapters/pdf");
      if(!live())return false;
      const opened=await Engine.open(bytes,{name,signal:abort.signal,onProgress:next=>{if(live())setProgress(next);},onPassword:reason=>new Promise<string|null>(resolve=>{
        if(!live()){resolve(null);return;}
        passwordResolver.current=resolve;
        setPasswordRequest({requestId:crypto.randomUUID(),reason,message:reason==="incorrect"?"パスワードが違います。もう一度入力してください。":"このPDFを開くためのパスワードを入力してください。"});
      })});
      candidate.session=opened;if(!live())return false;
      // Unsupported source restrictions are visible before OCR or editing.
      if(!opened.info.capabilities.export.allowed)setNotice(opened.info.capabilities.export.reason??"このPDFは読み取り専用です。");
      setState("analyzing");
      const analysis=await opened.analyze({signal:abort.signal,ocr:"auto",onProgress:next=>{if(live())setProgress(next);}});
      if(!live())return false;
      const previous=session.current,previousBytes=original.current;
      session.current=opened;original.current=bytes;pending.current=null;
      previousBytes?.fill(0);void previous?.dispose();
      commitTask(createPdfTask(analysis));setState("ready");setProgress(null);
      setNotice(!analysis.complete?"読み取れなかったページがあります。完了した項目への記入は続けられます。":analysis.fields.length?null:"入力欄が見つかりませんでした。原本で記入場所を指定できます。");
      return true;
    }catch(cause){
      if(!live())return false;
      setState(taskRef.current?"ready":"failed");setProgress(null);
      setError(cause instanceof Error?cause.message:"書類を読み取れませんでした。");
      return false;
    }finally{
      if(pending.current===candidate)pending.current=null;
      if(!candidate.session||session.current!==candidate.session){candidate.bytes?.fill(0);await candidate.session?.dispose();}
    }
  },[invalidateJob,clearOutput,commitTask]);
  const cancel=useCallback(()=>{
    const candidate=pending.current,partial=!taskRef.current?candidate?.session?.getAnalysis():null;
    invalidateJob();
    if(partial&&candidate?.session){
      session.current=candidate.session;original.current=candidate.bytes;pending.current=null;
      commitTask(createPdfTask(checkpointPdfAnalysis(partial)));
    }
    setState(taskRef.current?"ready":"cancelled");setProgress(null);
    setNotice("処理を中止しました。入力済みの内容と完了したページは保持されています。");
  },[commitTask,invalidateJob]);

  const exportPdf=useCallback(async(options?:{inputMode:"direct"})=>{
    const current=taskRef.current,reading=session.current;if(!current||!reading)return;const problems=options?.inputMode==="direct"?getDirectPdfTaskIssues(current):getPdfTaskIssues(current);if(problems.length){setError(problems[0].message);return;}if(!current.analysis.document.capabilities.export.allowed){setError(current.analysis.document.capabilities.export.reason??"この形式は書き出しに対応していません。");return;}
    invalidateJob();const abort=new AbortController();controller.current=abort;const token=generation.current;
    const live=()=>mounted.current&&token===generation.current&&!abort.signal.aborted&&taskRef.current?.id===current.id&&taskRef.current.revision===current.revision;
    clearOutput();setState("exporting");setError(null);
    try {
      const result=await reading.export({inputMode:options?.inputMode,fields:current.fields,answers:current.answers,answerStatus:current.answerStatus,pageReviews:current.pages.map(page=>({pageIndex:page.index,review:page.review})),mode:current.exportMode,allowIncomplete:options?.inputMode==="direct"?true:current.allowIncomplete,actionRemovalConfirmed:current.actionRemovalConfirmed,signal:abort.signal,onProgress:next=>{if(live()){setProgress(next);setState(next.stage==="validation"?"validating":"exporting");}}});
      if(!live())return;if(!result.validated)throw new Error("出力の検証に合格していません。問題の項目を修正してください。");
      const preview=await reading.openValidatedOutput(result,{name:current.title,signal:abort.signal});if(!live()){await preview.dispose();return;}
      outputSession.current=preview;outputRef.current={result,taskId:current.id,revision:current.revision,inputMode:options?.inputMode};const {bytes,...metadata}=result;setOutputState({...metadata,byteLength:bytes.length});setState("ready");setNotice(options?.inputMode==="direct"?null:"保存するPDFを再読み込みして検証しました。記入結果を確認してから保存してください。");return true;
    }catch(cause){
      if(!live())return;setState("ready");
      const issue=cause instanceof PdfEngineError?cause.issues.find(item=>item.severity==="error"):undefined;
      if(issue?.fieldId&&taskRef.current?.fields.some(field=>field.id===issue.fieldId))commitTask({...taskRef.current!,selectedFieldId:issue.fieldId});
      setError(issue?.message??(cause instanceof Error?cause.message:"PDFを作成できませんでした。"));
    }
  },[invalidateJob,clearOutput,commitTask]);

  const retryPages=useCallback(async(pageIndices?:number[],retryOptions:{ocrTimeoutMs?:90_000|180_000}={})=>{
    const current=taskRef.current,reading=session.current;if(!current||!reading)return;
    const requested=pageIndices??[...new Set(current.analysis.issues.flatMap(i=>i.pageIndex===undefined?[]:[i.pageIndex]))],selected=requested.length?requested:current.pages.map(p=>p.index);
    invalidateJob();const abort=new AbortController();controller.current=abort;const token=generation.current;setState("analyzing");setError(null);setReanalysisDiff(null);setNotice(retryOptions.ocrTimeoutMs===180_000?"待ち時間を180秒へ延長し、選んだページを最初から読み取ります。確認済みの項目と回答は、差分を採用するまで保持します。":null);
    const live=()=>mounted.current&&token===generation.current&&!abort.signal.aborted&&taskRef.current?.id===current.id&&taskRef.current.revision===current.revision;
    try{const analysis=await reading.analyze({pageIndices:selected,signal:abort.signal,ocr:"auto",...(retryOptions.ocrTimeoutMs!==undefined?{ocrTimeoutMs:retryOptions.ocrTimeoutMs}:{}),onProgress:next=>{if(live()){setProgress(next);}}});if(!live())return;setReanalysisDiff(buildPdfReanalysisDiff(current,analysis,selected));setState("ready");setNotice("再解析の差分を確認してください。対応と回答は採用するまで変更しません。");}catch(cause){if(!live())return;setState("ready");setError(cause instanceof Error?cause.message:"ページを再解析できませんでした。");}
  },[invalidateJob]);
  const acceptReanalysis=useCallback((changeIds:string[])=>{
    const current=taskRef.current;if(!current||!reanalysisDiff)return;
    const plan=planPdfReanalysisAdoption(current,reanalysisDiff,changeIds);if(!plan.update){setError(plan.reason);return;}
    update(()=>plan.update!);setReanalysisDiff(null);setNotice("選んだ差分を採用しました。対象外にした候補は対象外のまま残しています。必要な候補だけを原本で確認して対象へ戻せます。");
  },[reanalysisDiff,update]);
  const rejectReanalysis=useCallback(()=>{setReanalysisDiff(null);setNotice("再解析の候補を採用せず、元の対応と回答を保持しました。");},[]);

  const download=useCallback(async(options?:{inputMode:"direct"})=>{
    const current=taskRef.current,snapshot=outputRef.current;if(!current||!snapshot||snapshot.taskId!==current.id||snapshot.revision!==current.revision||(!outputConfirmed&&!(options?.inputMode==="direct"&&snapshot.inputMode==="direct"))||downloadCleanup.current)return;
    const url=URL.createObjectURL(new Blob([snapshot.result.bytes.slice().buffer as ArrayBuffer],{type:"application/pdf"}));
    const filename=current.title.replace(/\.pdf$/i,"").replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_")+"-記入済み.pdf";
    const api=getWebExtensionApi();let closed=false;let watcher:(()=>void)|null=null;let timer:ReturnType<typeof setTimeout>|undefined;
    const release=()=>{if(closed)return;closed=true;watcher?.();clearTimeout(timer);URL.revokeObjectURL(url);if(downloadCleanup.current===release)downloadCleanup.current=null;};
    const live=()=>mounted.current&&taskRef.current?.id===current.id&&taskRef.current.revision===snapshot.revision;
    const fail=(message:string)=>{release();if(live()){setState("ready");setError(message);}};
    // A native file chooser may remain open indefinitely. Keep its blob alive;
    // completion monitoring starts only after the browser returns a download ID.
    const notSaved=()=>{release();if(live()){setState("ready");setError(null);setNotice("PDFは保存されていません。入力内容はそのままです。「PDFを保存」からもう一度保存できます。");}};
    downloadCleanup.current=release;setState("downloading");setError(null);
    try {
      if(api?.downloads){const id=await api.downloads.download({url,filename,saveAs:true});if(closed)return;
        watcher=watchPdfDownload(api.downloads,id,{onComplete:()=>{release();if(live()){setState("ready");if(live()){commitTask({...taskRef.current!,stage:"saved"});setNotice("記入済みPDFを保存しました。申請の提出は案内を確認してご自身で行ってください。");}}},onError:fail,onCancel:notSaved});
      }else{const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();setState("ready");setNotice("PDFの保存操作を開始しました。ブラウザーの保存結果を確認してください。");clearTimeout(timer);timer=setTimeout(release,60_000);}
    // Rejection before an ID is returned also covers chooser cancellation. Its
    // browser-specific message is not a stable API for distinguishing failures.
    }catch{notSaved();}
  },[commitTask,outputConfirmed]);
  const directSavePending=useRef(false);
  const savePdfDirect=useCallback(async()=>{if(directSavePending.current)return;directSavePending.current=true;try{if(await exportPdf({inputMode:"direct"}))await download({inputMode:"direct"});}finally{directSavePending.current=false;}},[exportPdf,download]);
  return {task,taskRef,setTask,state,progress,error,setError,notice,setNotice,output,outputConfirmed,setOutputConfirmed,passwordRequest,providePassword,reanalysisDiff,retryPages,reanalyzePages:retryPages,acceptReanalysis,rejectReanalysis,session,outputSession,original,open,update,cancel,exportPdf,download,savePdfDirect,dispose};
}

