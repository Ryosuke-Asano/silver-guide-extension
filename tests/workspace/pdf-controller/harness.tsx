import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {usePdfWorkspace} from "../../../src/apps/workspace/usePdfWorkspace";
import {nativeFixture} from "../../pdf/harness";
import {PDFDocument} from "pdf-lib";
import {PdfSession,pdfFieldSourceReadOnly} from "../../../src/adapters/pdf";
import {encryptedFixture} from "./encrypted-fixture";
import {nativePreviewContract,overlayPreviewContract,previewSnapshotCache,invalidPreviewRetainsAnswers,previewPageReviewContract} from "./preview-contract";

type Controller=ReturnType<typeof usePdfWorkspace>;
let controller:Controller;
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
function Harness(){controller=usePdfWorkspace();return <output data-state={controller.state}>{controller.task?.title??"empty"} {controller.output?.validated?"validated":""} {controller.error??""}</output>;}
createRoot(document.querySelector("#root")!).render(<StrictMode><Harness/></StrictMode>);
async function prepare(){await controller.open(await nativeFixture(),"最初の架空申請書.pdf");controller.update(current=>({fields:current.fields.map(field=>({...field,role:"applicant",mappingState:"confirmed"})),pages:current.pages.map(page=>({...page,review:"inputs-confirmed"})),answers:Object.fromEntries(current.fields.map(field=>[field.id,"山田 花子"])),answerStatus:Object.fromEntries(current.fields.map(field=>[field.id,"entered"])),stage:"reviewing"}));await tick();}
async function password(reason:"required"|"incorrect"){for(let attempt=0;attempt<300;attempt++){if(controller.passwordRequest?.reason===reason)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error("Password request absent: "+reason);}
type DownloadProbe = {
  before:PdfTaskSnapshot;original:Uint8Array;requests:Array<{url:string;filename:string;saveAs:boolean}>;
  listeners:Set<(delta:unknown)=>void>;revoked:string[];searches:number;job:Promise<void>|null;
  resolve:((id:number)=>void)|null;reject:((reason:unknown)=>void)|null;restore:()=>void;
};
type PdfTaskSnapshot = NonNullable<Controller["task"]>;
let downloadProbe:DownloadProbe|null=null;
function downloadSnapshot(){
  const probe=downloadProbe!;
  return {state:controller.state,error:controller.error,notice:controller.notice,stage:controller.taskRef.current?.stage,
    answersRetained:JSON.stringify(controller.taskRef.current?.answers)===JSON.stringify(probe.before.answers),
    originalRetained:controller.original.current?.length===probe.original.length&&controller.original.current.every((value,index)=>value===probe.original[index]),
    validated:controller.output?.validated===true,requests:probe.requests.length,revoked:probe.revoked.length,searches:probe.searches,listeners:probe.listeners.size};
}
async function startProbeSave(){
  const probe=downloadProbe!,expected=probe.requests.length+1;
  probe.job=controller.savePdfDirect();
  for(let attempt=0;attempt<300;attempt++){if(probe.requests.length===expected){await tick();return downloadSnapshot();}await tick();}
  throw Error("Download request absent");
}
const api={
  nativePreviewContract,overlayPreviewContract,previewSnapshotCache,invalidPreviewRetainsAnswers,previewPageReviewContract,
  async beginSaveDownload(){
    await prepare();const priorBrowser=(window as unknown as {browser?:unknown}).browser,priorRevoke=URL.revokeObjectURL;
    const probe:DownloadProbe={before:structuredClone(controller.taskRef.current!),original:controller.original.current!.slice(),requests:[],listeners:new Set(),revoked:[],searches:0,job:null,resolve:null,reject:null,restore:()=>{URL.revokeObjectURL=priorRevoke;(window as unknown as {browser?:unknown}).browser=priorBrowser;}};
    downloadProbe=probe;
    URL.revokeObjectURL=url=>{if(probe.requests.some(request=>request.url===url))probe.revoked.push(url);priorRevoke.call(URL,url);};
    (window as unknown as {browser:unknown}).browser={runtime:{sendMessage:()=>Promise.resolve(),getURL:(path:string)=>new URL(`/${path}`,location.origin).href},downloads:{
      download:(request:{url:string;filename:string;saveAs:boolean})=>{probe.requests.push(request);return new Promise<number>((resolve,reject)=>{probe.resolve=resolve;probe.reject=reject;});},
      search:()=>{probe.searches++;return Promise.resolve([{id:91,state:"in_progress"}]);},
      onChanged:{addListener:(listener:(delta:unknown)=>void)=>probe.listeners.add(listener),removeListener:(listener:(delta:unknown)=>void)=>probe.listeners.delete(listener)}
    }};
    return startProbeSave();
  },
  downloadSnapshot,
  async resolveSaveDownload(){const probe=downloadProbe!;probe.resolve!(91);await probe.job;await tick();return downloadSnapshot();},
  async rejectSaveDownload(){const probe=downloadProbe!;probe.reject!({message:"Download canceled by the user"});await probe.job;await tick();return downloadSnapshot();},
  async retrySaveDownload(){return startProbeSave();},
  async completeSaveDownload(){downloadProbe!.listeners.forEach(listener=>listener({id:91,state:{current:"complete"}}));await tick();return downloadSnapshot();},
  async cancelSaveDownload(){downloadProbe!.listeners.forEach(listener=>listener({id:91,state:{current:"interrupted"},error:{current:"USER_CANCELED"}}));await tick();return downloadSnapshot();},
  async failSaveDownload(){downloadProbe!.listeners.forEach(listener=>listener({id:91,state:{current:"interrupted"},error:{current:"FILE_FAILED"}}));await tick();return downloadSnapshot();},
  async finishSaveDownload(){const probe=downloadProbe;if(probe){probe.reject?.({message:"test cleanup"});await probe.job;await controller.dispose();probe.restore();downloadProbe=null;}return {};},
  async extendedRetryPreservesWork(){
    await prepare();const before=structuredClone(controller.taskRef.current!),reading=controller.session.current!,original=reading.getOriginalBytes(),analyze=reading.analyze.bind(reading);let received:{pages?:number[];timeout?:number}|null=null;
    reading.analyze=options=>{received={pages:options?.pageIndices,timeout:options?.ocrTimeoutMs};return analyze(options);};
    try{await controller.retryPages([0],{ocrTimeoutMs:180_000});await tick();const after=controller.taskRef.current!,bytes=reading.getOriginalBytes();return{received,sameFields:JSON.stringify(after.fields)===JSON.stringify(before.fields),sameAnswers:JSON.stringify(after.answers)===JSON.stringify(before.answers),sameRevision:after.revision===before.revision,sameOriginal:bytes.length===original.length&&bytes.every((value,index)=>value===original[index]),diffPending:controller.reanalysisDiff?.baseRevision===before.revision&&controller.reanalysisDiff.changes.some(change=>change.protected),state:controller.state};}
    finally{reading.analyze=analyze;await controller.dispose();}
  },
  async failedReplacementPreservesWork(){
    await prepare();const before=structuredClone(controller.taskRef.current!),original=controller.original.current!.slice();
    const failed=await controller.open(new TextEncoder().encode("not a pdf"),"壊れた原本.pdf");await tick();
    const sameAfterFailure=JSON.stringify(controller.taskRef.current)===JSON.stringify(before);
    const cancelled=controller.open(encryptedFixture,"暗号化原本.pdf");await password("required");controller.providePassword(null);const cancelledOutcome=await cancelled;await tick();
    const sameAfterCancel=JSON.stringify(controller.taskRef.current)===JSON.stringify(before),originalRetained=controller.original.current!.every((value,index)=>value===original[index]);
    const opening=controller.open(encryptedFixture,"暗号化原本.pdf");await password("required");controller.providePassword("wrong");await password("incorrect");controller.providePassword("synthetic-pdf-password");const opened=await opening;await tick();
    return{failed,sameAfterFailure,cancelledOutcome,sameAfterCancel,originalRetained,opened,exportAllowed:controller.taskRef.current!.analysis.document.capabilities.export.allowed,sourceReadOnly:controller.taskRef.current!.fields.every(pdfFieldSourceReadOnly),code:controller.taskRef.current!.analysis.document.issues.some(issue=>issue.code==="ENCRYPTED_READ_ONLY")};
  },
  async cancelBeforeMetadata(){
    class SlowBlob extends Blob{override async arrayBuffer(){await new Promise(resolve=>setTimeout(resolve,80));return super.arrayBuffer();}}
    const bytes=await nativeFixture(),job=controller.open(new SlowBlob([bytes.slice().buffer as ArrayBuffer]),"中止する原本.pdf");controller.cancel();const outcome=await job;await tick();const after={outcome,state:controller.state,task:controller.taskRef.current,original:controller.original.current};
    const retry=await controller.open(bytes,"再試行する原本.pdf");await tick();return{...after,retry,title:controller.taskRef.current?.title};
  },
  async cancelDuringScan(){
    const source=await PdfSession.open(await nativeFixture()),canvas=document.createElement("canvas");await source.render(0,canvas,{scale:2});await source.dispose();
    const png=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),"image/png")),doc=await PDFDocument.create(),image=await doc.embedPng(await png.arrayBuffer());
    for(let index=0;index<4;index++){const page=doc.addPage([595,842]);page.drawImage(image,{x:0,y:0,width:595,height:842});}
    const bytes=await doc.save(),analyze=PdfSession.prototype.analyze;let started=0,cancelMs=0;
    PdfSession.prototype.analyze=function(options={}){return analyze.call(this,{...options,onProgress:next=>{options.onProgress?.(next);if(next.stage==="structure"&&next.completed===1&&!started){started=performance.now();controller.cancel();cancelMs=performance.now()-started;}}});};
    try{await controller.open(bytes,"途中まで解析した原本.pdf");}finally{PdfSession.prototype.analyze=analyze;}
    await tick();const task=controller.taskRef.current!,result={cancelMs,checkpointPages:task.pages.filter(page=>page.extraction!=="unusable").length,checkpointFields:task.fields.length,complete:task.analysis.complete,issues:task.analysis.issues.map(issue=>issue.code),sameOriginal:controller.original.current?.length===bytes.length&&controller.original.current.every((value,index)=>value===bytes[index]),unresolved:task.pages.filter(page=>page.extraction==="unusable").length,state:controller.state};await controller.dispose();return result;
  },
  async cancelDuringExport(){await prepare();const before=structuredClone(controller.taskRef.current!),bytes=controller.original.current!.slice(),job=controller.exportPdf();controller.cancel();await job;await tick();return{sameTask:JSON.stringify(controller.taskRef.current)===JSON.stringify(before),sameOriginal:controller.original.current?.every((value,index)=>value===bytes[index]),output:controller.output!==null,state:controller.state};},
  async exportAndNavigate(){await prepare();await controller.exportPdf();await tick();const original=controller.output;const hasBinary=Boolean(original&&"bytes"in original);controller.update(current=>({selectedFieldId:current.fields[1].id,stage:"filling"}));await tick();const retained=controller.output===original;controller.update(current=>({answers:{...current.answers,[current.fields[0].id]:"変更した架空回答"}}));await tick();return {validated:original?.validated,hasBinary,retained,invalidated:controller.output===null,state:controller.state};},
  async editDuringExport(){await prepare();const before=controller.taskRef.current!;const job=controller.exportPdf();controller.update(current=>({answers:{...current.answers,[current.fields[0].id]:"編集後の架空回答"}}));await job;await tick();return {output:controller.output!==null,state:controller.state,revision:controller.taskRef.current!.revision,before:before.revision,answer:controller.taskRef.current!.answers[before.fields[0].id]};},
  async switchDuringExport(){await prepare();const bytes=await nativeFixture();const job=controller.exportPdf(),replacement=controller.open(bytes,"別の架空申請書.pdf");const previousRetainedWhileLoading=controller.taskRef.current?.title==="最初の架空申請書.pdf";await Promise.all([job,replacement]);await tick();return {previousRetainedWhileLoading,title:controller.taskRef.current?.title,output:controller.output!==null,state:controller.state};},
  async staleDownload(){await prepare();await controller.exportPdf();await tick();controller.setOutputConfirmed(true);await tick();const listeners=new Set<(value:unknown)=>void>();let revoked=0;const originalRevoke=URL.revokeObjectURL,priorBrowser=(window as unknown as {browser?:unknown}).browser;URL.revokeObjectURL=()=>{revoked++;};(window as unknown as {browser:unknown}).browser={runtime:{sendMessage:()=>Promise.resolve(),getURL:(path:string)=>new URL(`/${path}`,location.origin).href},storage:{local:{}},downloads:{download:()=>Promise.resolve(91),search:()=>Promise.resolve([{id:91,state:"in_progress"}]),onChanged:{addListener:(listener:(value:unknown)=>void)=>listeners.add(listener),removeListener:(listener:(value:unknown)=>void)=>listeners.delete(listener)}}};try{await controller.download();await tick();const late=[...listeners];controller.update(current=>({answers:{...current.answers,[current.fields[0].id]:"保存操作後に編集した架空回答"}}));await tick();const detached=listeners.size===0;for(const listener of late)listener({id:91,state:{current:"complete"}});await tick();return {detached,revoked,stage:controller.taskRef.current?.stage,state:controller.state,output:controller.output!==null};}finally{URL.revokeObjectURL=originalRevoke;(window as unknown as {browser?:unknown}).browser=priorBrowser;}},
};
(window as unknown as {pdfControllerTest:typeof api}).pdfControllerTest=api;
