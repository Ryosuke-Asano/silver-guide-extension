import {PDFDocument,degrees} from "pdf-lib";
import {PdfSession,makeManualPdfField,type PdfAnswers,type PdfBox,type PdfField,type PdfRenderResult} from "../../../src/adapters/pdf";

function sample(canvas:HTMLCanvasElement,result:PdfRenderResult,box:PdfBox){
  const [a,b,c,d,e,f]=result.pdfToViewport,points=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f]);
  const x=Math.max(0,Math.floor(Math.min(...points.map(point=>point[0])))),y=Math.max(0,Math.floor(Math.min(...points.map(point=>point[1]))));
  const width=Math.min(canvas.width-x,Math.ceil(Math.max(...points.map(point=>point[0])))-x),height=Math.min(canvas.height-y,Math.ceil(Math.max(...points.map(point=>point[1])))-y);
  const pixels=canvas.getContext("2d")!.getImageData(x,y,width,height).data;let ink=0,hash=2166136261;
  for(let offset=0;offset<pixels.length;offset++){hash=Math.imul(hash^pixels[offset],16777619);if(offset%4===0&&pixels[offset]<120&&pixels[offset+1]<120&&pixels[offset+2]<120)ink++;}
  return{ink,hash:hash>>>0};
}
const sameBytes=(left:Uint8Array,right:Uint8Array)=>left.length===right.length&&left.every((value,index)=>value===right[index]);
async function nativeSource(){
  const doc=await PDFDocument.create(),first=doc.addPage([595,842]),second=doc.addPage([595,842]),form=doc.getForm();second.setRotation(degrees(90));
  const shared=form.createTextField("shared");shared.setText("ORIGINAL");shared.addToPage(first,{x:80,y:650,width:300,height:40,borderWidth:0});shared.addToPage(second,{x:100,y:500,width:300,height:40,borderWidth:0});
  const locked=form.createTextField("locked");locked.setText("LOCKED");locked.enableReadOnly();locked.addToPage(first,{x:80,y:550,width:300,height:40,borderWidth:0});
  const check=form.createCheckBox("check");check.addToPage(first,{x:80,y:450,width:24,height:24});check.check();
  const radio=form.createRadioGroup("radio");radio.addOptionToPage("A",first,{x:80,y:350,width:24,height:24});radio.addOptionToPage("B",first,{x:150,y:350,width:24,height:24});radio.select("A");
  const select=form.createDropdown("select");select.addOptions(["North","South"]);select.select("North");select.addToPage(first,{x:80,y:250,width:300,height:35});
  const bytes=await doc.save(),session=await PdfSession.open(bytes),fields=(await session.analyze({ocr:"never"})).fields.filter(field=>field.native);return{bytes,session,fields};
}

export async function nativePreviewContract(){
  const{bytes,session,fields}=await nativeSource(),canvas=document.createElement("canvas"),byName=(name:string)=>fields.find(field=>field.native?.name===name)!;
  const answers:PdfAnswers=Object.fromEntries(fields.map(field=>[field.id,structuredClone(field.initialValue)])),status=Object.fromEntries(fields.map(field=>[field.id,"entered"]));
  const beforeFields=structuredClone(fields),initialAnswers=structuredClone(answers);let exportCalls=0;const priorExport=session.export;session.export=async()=>{exportCalls++;throw Error("Preview must not use the public export action");};
  try{
    const original=await session.render(0,canvas,{scale:1.4}),originalText=sample(canvas,original,[84,654,376,686]),originalLocked=sample(canvas,original,[84,554,376,586]),originalCheck=sample(canvas,original,[83,453,101,471]),originalRadioA=sample(canvas,original,[83,353,101,371]),originalRadioB=sample(canvas,original,[153,353,171,371]),originalSelect=sample(canvas,original,[84,254,376,281]);
    answers[byName("shared").id]="山田 花子";answers[byName("check").id]=false;answers[byName("radio").id]="B";answers[byName("select").id]="South";
    const beforeAnswers=structuredClone(answers),preview=await session.renderPreview(0,canvas,{scale:1.4,fields,answers,answerStatus:status});
    const changed={text:sample(canvas,preview,[84,654,376,686]),locked:sample(canvas,preview,[84,554,376,586]),check:sample(canvas,preview,[83,453,101,471]),radioA:sample(canvas,preview,[83,353,101,371]),radioB:sample(canvas,preview,[153,353,171,371]),select:sample(canvas,preview,[84,254,376,281])};
    const rotated=await session.renderPreview(1,canvas,{scale:1.4,fields,answers,answerStatus:status}),rotatedText=sample(canvas,rotated,[104,504,396,536]);
    const retainedAnswers=JSON.stringify(answers)===JSON.stringify(beforeAnswers);answers[byName("shared").id]="";
    const cleared=await session.renderPreview(0,canvas,{scale:1.4,fields,answers,answerStatus:{...status,[byName("shared").id]:"empty"}}),clearedFirst=sample(canvas,cleared,[84,654,376,686]);
    const clearedRotated=await session.renderPreview(1,canvas,{scale:1.4,fields,answers,answerStatus:{...status,[byName("shared").id]:"empty"}}),clearedSecond=sample(canvas,clearedRotated,[104,504,396,536]);
    const source=await session.render(0,canvas,{scale:1.4}),originalAgain=sample(canvas,source,[84,654,376,686]);
    return{originalText,originalLocked,originalCheck,originalRadioA,originalRadioB,originalSelect,changed,rotatedText,rotatedSize:[rotated.width,rotated.height],clearedFirst,clearedSecond,
      originalUnchanged:JSON.stringify(originalAgain)===JSON.stringify(originalText)&&sameBytes(session.getOriginalBytes(),bytes),fieldsUnchanged:JSON.stringify(fields)===JSON.stringify(beforeFields),answersUnchanged:retainedAnswers,readonlyAnswerUnchanged:answers[byName("locked").id]===initialAnswers[byName("locked").id],exportCalls,resultKeys:Object.keys(preview).sort()};
  }finally{session.export=priorExport;await session.dispose();}
}

export async function overlayPreviewContract(){
  const doc=await PDFDocument.create();doc.addPage([595,842]);doc.addPage([595,842]).setRotation(degrees(270));const bytes=await doc.save(),session=await PdfSession.open(bytes),canvas=document.createElement("canvas");
  const writable=makeManualPdfField(0,[80,650,380,690],"OCRで見つけた記入欄");writable.source="inferred";writable.placements.push({...writable.placements[0],pageIndex:1});
  const rejected={...makeManualPdfField(0,[80,550,380,590],"今回記入しない欄"),mappingState:"rejected" as const};
  const locked={...makeManualPdfField(0,[80,450,380,490],"係員欄"),role:"office" as const};
  const trigger=makeManualPdfField(0,[80,250,104,274],"対象になる", "checkbox");
  const conditional={...makeManualPdfField(0,[80,350,380,390],"条件に当てはまるとき"),conditionStatus:"confirmed" as const,condition:{op:"eq" as const,fieldId:trigger.id,value:true},conditionSource:{text:"対象になる場合のみ記入",pageIndex:0}};
  const fields=[writable,rejected,locked,trigger,conditional],answers:PdfAnswers={[writable.id]:"山田 花子",[rejected.id]:"保持する回答",[locked.id]:null,[trigger.id]:false,[conditional.id]:null},before=JSON.stringify({fields,answers});
  try{
    const result=await session.renderPreview(0,canvas,{scale:1.4,fields,answers}),visible=sample(canvas,result,[84,654,376,686]);
    const excluded=[sample(canvas,result,[84,554,376,586]).ink,sample(canvas,result,[84,454,376,486]).ink,sample(canvas,result,[84,354,376,386]).ink];
    const other=await session.renderPreview(1,canvas,{scale:1.4,fields,answers}),otherInk=sample(canvas,other,[84,654,376,686]).ink;
    return{visible,excluded,otherInk,rotatedSize:[other.width,other.height],stateUnchanged:JSON.stringify({fields,answers})===before,originalUnchanged:sameBytes(session.getOriginalBytes(),bytes)};
  }finally{await session.dispose();}
}

export async function previewSnapshotCache(){
  const{bytes,session,fields}=await nativeSource(),canvas=document.createElement("canvas"),shared=fields.find(field=>field.native?.name==="shared")!;
  const answers=Object.fromEntries(fields.map(field=>[field.id,field.id===shared.id?"試験 花子":structuredClone(field.initialValue)]));
  const OriginalWorker=window.Worker,originalFetch=window.fetch;let workers=0,fontFetches=0;
  window.Worker=class extends OriginalWorker{constructor(...args:ConstructorParameters<typeof Worker>){workers++;super(...args);}};
  window.fetch=(...args:Parameters<typeof fetch>)=>{const url=String(args[0] instanceof Request?args[0].url:args[0]);if(url.includes("NotoSansJP-Regular.ttf"))fontFetches++;return originalFetch(...args);};
  try{
    await session.renderPreview(0,canvas,{scale:1,fields,answers});const initialWorkers=workers;
    await session.renderPreview(1,canvas,{scale:2,fields,answers});await session.renderPreview(0,canvas,{scale:.75,fields:structuredClone(fields),answers:structuredClone(answers)});const cachedWorkers=workers;
    await session.renderPreview(0,canvas,{scale:1,fields,answers:{...answers,[shared.id]:"別の架空回答"}});
    return{initialWorkers,cachedWorkers,changedWorkers:workers,fontFetches,originalUnchanged:sameBytes(session.getOriginalBytes(),bytes)};
  }finally{window.Worker=OriginalWorker;window.fetch=originalFetch;await session.dispose();}
}

export async function invalidPreviewRetainsAnswers(){
  const doc=await PDFDocument.create();doc.addPage([595,842]);const bytes=await doc.save(),session=await PdfSession.open(bytes),canvas=document.createElement("canvas");
  const text={...makeManualPdfField(0,[80,650,380,690],"氏名"),maxGraphemes:2},trigger=makeManualPdfField(0,[80,550,104,574],"対象", "checkbox");
  const conditional={...makeManualPdfField(0,[80,450,380,490],"条件に合う場合"),conditionStatus:"confirmed" as const,condition:{op:"eq" as const,fieldId:trigger.id,value:true},conditionSource:{text:"対象のときだけ記入",pageIndex:0}};
  const fields=[text,trigger,conditional],cases:PdfAnswers[]=[{[text.id]:"長すぎる回答",[trigger.id]:false,[conditional.id]:null},{[text.id]:["保持する配列"],[trigger.id]:false,[conditional.id]:null},{[text.id]:null,[trigger.id]:false,[conditional.id]:"保持する条件外回答"}];
  const errors:Array<{code:string;issues:string[];unchanged:boolean}>=[];
  try{
    for(const answers of cases){const before=JSON.stringify(answers);try{await session.renderPreview(0,canvas,{fields,answers});errors.push({code:"NO_ERROR",issues:[],unchanged:JSON.stringify(answers)===before});}catch(cause){const error=cause as {code:string;issues:Array<{code:string}>};errors.push({code:error.code,issues:error.issues.map(issue=>issue.code),unchanged:JSON.stringify(answers)===before});}}
    const repaired:PdfAnswers={[text.id]:"山田",[trigger.id]:false,[conditional.id]:null},result=await session.renderPreview(0,canvas,{fields,answers:repaired});
    return{errors,repairedInk:sample(canvas,result,[84,654,376,686]).ink,retainedCases:cases,originalUnchanged:sameBytes(session.getOriginalBytes(),bytes)};
  }finally{await session.dispose();}
}

export async function previewPageReviewContract(){
  const doc=await PDFDocument.create();doc.addPage([595,842]);const bytes=await doc.save(),session=await PdfSession.open(bytes),canvas=document.createElement("canvas");
  const fields=[makeManualPdfField(0,[80,650,380,690],"氏名")],answers:PdfAnswers={[fields[0].id]:"山田 花子"},before=JSON.stringify({fields,answers});
  try{
    const allowed=await session.renderPreview(0,canvas,{fields,answers,pageReviews:[{pageIndex:0,review:"inputs-confirmed"}]}),allowedInk=sample(canvas,allowed,[84,654,376,686]).ink;
    let code="NO_ERROR",issues:string[]=[];try{await session.renderPreview(0,canvas,{fields,answers,pageReviews:[{pageIndex:0,review:"excluded"}]});}catch(cause){const error=cause as {code:string;issues:Array<{code:string}>};code=error.code;issues=error.issues.map(issue=>issue.code);}
    const repaired=await session.renderPreview(0,canvas,{fields,answers,pageReviews:[{pageIndex:0,review:"inputs-confirmed"}]});
    return{allowedInk,code,issues,repairedInk:sample(canvas,repaired,[84,654,376,686]).ink,stateUnchanged:JSON.stringify({fields,answers})===before,originalUnchanged:sameBytes(session.getOriginalBytes(),bytes)};
  }finally{await session.dispose();}
}
