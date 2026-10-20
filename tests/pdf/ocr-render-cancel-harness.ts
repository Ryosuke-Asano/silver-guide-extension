import {PDFDocument} from "pdf-lib";
import {PdfSession} from "../../src/adapters/pdf";

async function scannedPages(count=2){
  const pdf=await PDFDocument.create();
  for(const title of ["FIRST PAGE","SECOND PAGE"].slice(0,count)){const canvas=document.createElement("canvas");canvas.width=2480;canvas.height=3508;const context=canvas.getContext("2d",{willReadFrequently:true})!;context.fillStyle="white";context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle="black";context.font="100px sans-serif";context.fillText(title,180,400);context.fillText("TEST 12345",180,700);const jpeg=await pdf.embedJpg(canvas.toDataURL("image/jpeg",.9));pdf.addPage([595.2,841.92]).drawImage(jpeg,{x:0,y:0,width:595.2,height:841.92});canvas.width=canvas.height=0;}
  return pdf.save();
}

async function observeBudget(timeout?:90_000|180_000){
  const session=await PdfSession.open(await scannedPages(1)),setTimeoutOriginal=window.setTimeout;const timers:Array<{delay:number;scheduledAt:number}>=[];let pageStarted=0;
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:unknown[])=>{if(delay!==undefined&&delay>=85_000&&delay<=181_000||delay===30_000)timers.push({delay:delay!,scheduledAt:performance.now()});return setTimeoutOriginal(handler,delay,...args);}) as typeof window.setTimeout;
  try{const result=await session.analyze({ocr:"always",...(timeout?{ocrTimeoutMs:timeout}:{}),onProgress:progress=>{if(progress.stage==="text")pageStarted=performance.now();}});return{complete:result.complete,timers,pageStarted};}
  finally{window.setTimeout=setTimeoutOriginal;await session.dispose();}
}

async function invalidBudgets(){
  const session=await PdfSession.open(await scannedPages(1)),progress:string[]=[],codes:string[]=[];
  try{for(const value of [0,180_001]){try{await session.analyze({ocrTimeoutMs:value as 90_000,onProgress:next=>progress.push(next.stage)});}catch(error){codes.push((error as {code:string}).code);}}return{codes,progress};}
  finally{await session.dispose();}
}

async function deadlineAndExtendedRetry(){
  const session=await PdfSession.open(await scannedPages(1)),clock=performance.now.bind(performance),originalDescriptor=Object.getOwnPropertyDescriptor(performance,"now"),originalHash=session.info.hash,originalBytes=session.getOriginalBytes();let offset=0,advanced=false;
  Object.defineProperty(performance,"now",{configurable:true,value:()=>clock()+offset});
  try{const timed=await session.analyze({ocr:"always",onProgress:progress=>{if(!advanced&&progress.stage==="ocr"&&progress.completed===1){advanced=true;offset=91_000;}}});offset=0;
    const retry=await session.analyze({ocr:"always",ocrTimeoutMs:180_000}),retriedBytes=session.getOriginalBytes();return{advanced,unresolved:!timed.complete,codes:timed.issues.map(issue=>issue.code),extraction:timed.document.pages[0].extraction,retryComplete:retry.complete,retryIssues:retry.issues,originalHashUnchanged:session.info.hash===originalHash,originalBytesUnchanged:retriedBytes.length===originalBytes.length&&retriedBytes.every((value,index)=>value===originalBytes[index])};
  }finally{if(originalDescriptor)Object.defineProperty(performance,"now",originalDescriptor);else delete(performance as unknown as {now?:unknown}).now;await session.dispose();}
}

async function cancelSecondPageRender(){
  const session=await PdfSession.open(await scannedPages()),controller=new AbortController();let insidePendingRender=false,cancelMs=0,cancellation="";const images=session as unknown as {pdf:{getPage:(index:number)=>Promise<{render:(...args:unknown[])=>{promise:Promise<unknown>}}>} };
  const second=await images.pdf.getPage(2),render=second.render.bind(second);let armed=true;
  second.render=(...args)=>{const task=render(...args);if(armed){armed=false;let settled=false;void task.promise.then(()=>{settled=true;},()=>{settled=true;});setTimeout(()=>{insidePendingRender=!settled;const start=performance.now();controller.abort();cancelMs=performance.now()-start;},0);}return task;};
  try{try{await session.analyze({ocr:"always",signal:controller.signal});}catch(error){cancellation=(error as Error).name;}
    const completed=session.getAnalysis(),firstPageRetained=Boolean(completed?.evidence.some(item=>item.pageIndex===0)),partial=completed?.evidence.length??0;
    const retry=await session.analyze({ocr:"always",pageIndices:[1]});
    return{insidePendingRender,cancelMs,cancellation,firstPageRetained,partial,retryComplete:retry.complete,retryEvidence:retry.evidence.map(item=>item.text)};
  }finally{await session.dispose();}
}

(window as unknown as {ocrRenderCancelTest:typeof cancelSecondPageRender}).ocrRenderCancelTest=cancelSecondPageRender;
(window as unknown as {ocrBudgetTest:{observe:typeof observeBudget;invalid:typeof invalidBudgets;deadline:typeof deadlineAndExtendedRetry}}).ocrBudgetTest={observe:observeBudget,invalid:invalidBudgets,deadline:deadlineAndExtendedRetry};
