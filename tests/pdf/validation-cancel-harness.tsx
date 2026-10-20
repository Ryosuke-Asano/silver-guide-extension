import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {PDFDocument} from "pdf-lib";
import {PdfSession} from "../../src/adapters/pdf";
import {usePdfWorkspace} from "../../src/apps/workspace/usePdfWorkspace";
import {armFault,clearFault,type ValidationFaultPhase} from "./validation-cancel-fault";

type Controller=ReturnType<typeof usePdfWorkspace>;
let controller:Controller;
function Harness(){controller=usePdfWorkspace();return <output>{controller.state}</output>;}
createRoot(document.querySelector("#root")!).render(<StrictMode><Harness/></StrictMode>);
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
async function fixture(){const doc=await PDFDocument.create(),page=doc.addPage([595,842]),field=doc.getForm().createTextField("name");field.addToPage(page,{x:70,y:650,width:300,height:50});page.drawText("SYNTHETIC VALIDATION TEST",{x:70,y:750,size:12});return doc.save();}
const sameBytes=(left:Uint8Array,right:Uint8Array)=>left.length===right.length&&left.every((value,index)=>value===right[index]);
async function settledWithin<T>(promise:Promise<T>,ms:number):Promise<{settled:boolean;value?:T}>{return Promise.race([promise.then(value=>({settled:true,value})),new Promise<{settled:false}>(resolve=>setTimeout(()=>resolve({settled:false}),ms))]);}

async function cancel(phase:ValidationFaultPhase){
  const bytes=await fixture(),reading=await PdfSession.open(bytes),analysis=await reading.analyze({ocr:"never"}),fields=analysis.fields.map(field=>({...field,role:"applicant" as const,mappingState:"confirmed" as const})),answers={[fields[0].id]:"架空の確認回答"},abort=new AbortController();
  let cancelledAt=0,settledAt=0,cancellation="",done=false;
  const state=armFault(phase,()=>{cancelledAt=performance.now();abort.abort();});
  try{const operation=reading.export({fields,answers,signal:abort.signal,onProgress:progress=>{if(progress.stage==="validation"&&progress.completed===0)state.armed=true;}}).then(()=>{done=true;},error=>{cancellation=error.name;settledAt=performance.now();done=true;});
    const observed=await settledWithin(operation,5000),beforeRetry={settled:observed.settled,cancellation,cancelMs:observed.settled?settledAt-cancelledAt:null,pendingObservedForMs:observed.settled?null:performance.now()-cancelledAt,held:state.held,destroyCalls:state.destroyCalls,ownedWorker:state.worker!==null,workerDestroyed:state.worker?.destroyed??false,originalRetained:sameBytes(reading.getOriginalBytes(),bytes),answerRetained:answers[fields[0].id]==="架空の確認回答"};
    clearFault();if(!done){await settledWithin(operation,1000);return{...beforeRetry,retryValidated:false};}
    const output=await reading.export({fields,answers}),preview=await reading.openValidatedOutput(output);try{const actual=await PDFDocument.load(output.bytes);return{...beforeRetry,retryValidated:output.validated,outputHashMatches:preview.info.hash===output.hash,actualValue:actual.getForm().getTextField("name").getText()};}finally{await preview.dispose();}
  }finally{clearFault();await reading.dispose();}
}

async function controllerCancel(phase:ValidationFaultPhase){
  const bytes=await fixture();await controller.open(bytes,"取消検証の架空原本.pdf");controller.update(task=>({fields:task.fields.map(field=>({...field,role:"applicant",mappingState:"confirmed"})),answers:{[task.fields[0].id]:"中止後も保持する架空回答"},answerStatus:{[task.fields[0].id]:"entered"},pages:task.pages.map(page=>({...page,review:"inputs-confirmed"})),stage:"reviewing"}));await tick();
  const before=structuredClone(controller.taskRef.current!),reading=controller.session.current!,genuineExport=reading.export.bind(reading);let cancelled=false,started=0;
  const state=armFault(phase,()=>{started=performance.now();cancelled=true;controller.cancel();});
  reading.export=options=>genuineExport({...options,onProgress:progress=>{if(progress.stage==="validation"&&progress.completed===0)state.armed=true;options.onProgress?.(progress);}});
  try{const operation=controller.exportPdf();for(let count=0;!cancelled&&count<300;count++)await tick();if(!cancelled)throw Error("Validation read was not reached");const observed=await settledWithin(operation,5000),elapsed=performance.now()-started;
    clearFault();if(!observed.settled)return{settled:false,cancelMs:elapsed,held:state.held};
    const sameTask=JSON.stringify(controller.taskRef.current)===JSON.stringify(before),originalRetained=Boolean(controller.original.current&&sameBytes(controller.original.current,bytes)),workerDestroyed=state.worker?.destroyed??false,outputAbsent=controller.output===null,destroyCalls=state.destroyCalls;
    await controller.exportPdf();await tick();return{settled:true,cancelMs:elapsed,held:state.held,sameTask,originalRetained,workerDestroyed,destroyCalls,outputAbsent,retryValidated:controller.output?.validated,sameAnswers:JSON.stringify(controller.taskRef.current?.answers)===JSON.stringify(before.answers)};
  }finally{clearFault();await controller.dispose();}
}
(window as unknown as {validationCancelTest:{cancel:typeof cancel;controllerCancel:typeof controllerCancel}}).validationCancelTest={cancel,controllerCancel};
