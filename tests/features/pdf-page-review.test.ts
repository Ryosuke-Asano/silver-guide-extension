import {describe,expect,it} from "vitest";
import {makeManualPdfField,rectToQuad,type PdfAnalysis,type PdfBox,type PdfEvidence,type PdfField,type PdfPageInfo} from "../../src/domain/pdf";
import {derivePdfPageReviewSummaries} from "../../src/features/pdf/page-review";

function page(index=0):PdfPageInfo{return{index,label:String(index+1),mediaBox:[0,0,595,842],cropBox:[0,0,595,842],visibleBox:[0,0,595,842],rotation:0,userUnit:1,widthPt:595,heightPt:842,extraction:"native",review:"unseen"};}
function field(id:string,index=0,label="氏名",box:PdfBox=[60,650,260,680]):PdfField{return{...makeManualPdfField(index,box,label),id,source:"inferred",role:"applicant",required:false,mappingState:"confirmed"};}
function evidence(id:string,text:string,index=0,box:PdfBox=[60,770,480,784]):PdfEvidence{return{id,text,pageIndex:index,quad:rectToQuad(box),method:"native",rawOcrConfidence:null};}
function analysis(fields:PdfField[]=[],text:PdfEvidence[]=[],pages:PdfPageInfo[]=[page()]):PdfAnalysis{
  const allowed={allowed:true,reason:null};return{document:{id:"original",hash:"a".repeat(64),name:"架空の帳票.pdf",byteLength:2048,pageCount:pages.length,pages,capabilities:{read:allowed,analyze:allowed,nativeWrite:allowed,overlayWrite:allowed,export:allowed},issues:[],actionDependent:false},fields,evidence:text,issues:[],complete:true};
}
function freeze<T>(value:T):T{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function dense(checklist=false){
  const fields:PdfField[]=[],text:PdfEvidence[]=[];
  for(let row=0;row<8;row++)for(let column=0;column<10;column++){
    const id=`cell-${row}-${column}`,label=checklist?"□":String(row*10+column+1),box:PdfBox=[40+column*50,400+row*40,70+column*50,425+row*40],item=field(id,0,label,box);
    if(checklist)item.kind="checkbox";item.evidenceIds=[`source-${id}`];fields.push(item);text.push(evidence(`source-${id}`,label,0,box));
  }
  return analysis(fields,text);
}

describe("derived PDF page review observations",()=>{
  it("counts a question once on every direct/option page and exposes shared membership without changing native restrictions",()=>{
    const shared=field("shared");shared.options=[{id:"a",label:"選択肢",exportValue:"a",placements:[{...shared.placements[0],pageIndex:1},{...shared.placements[0],pageIndex:2},{...shared.placements[0],pageIndex:1}]}];
    const rejected={...field("rejected",1),mappingState:"rejected" as const,role:"unknown" as const},locked=field("locked",1);
    locked.native={name:"locked",fieldRef:"42 0 R",widgetRefs:["43 0 R"],maxLength:null,lengthUnit:"utf16-code-unit",multiSelect:false,editableSelect:false,originalReadOnly:true,unsupported:false};
    const optionOnly=field("option-only",2);optionOnly.options=[{id:"b",label:"選択肢",exportValue:"b",placements:structuredClone(optionOnly.placements)}];optionOnly.placements=[];
    const unknown={...field("unconfirmed"),required:"unknown" as const},input=freeze(analysis([shared,rejected,locked,optionOnly,unknown],[],[page(),page(1),page(2)])),before=structuredClone(input);
    const summaries=derivePdfPageReviewSummaries(input);
    expect(summaries.map(summary=>({page:summary.pageIndex,candidate:summary.candidateCount,active:summary.activeCount,unknown:summary.unknownCount,rejected:summary.rejectedCount,shared:summary.sharedFieldCount}))).toEqual([
      {page:0,candidate:2,active:2,unknown:1,rejected:0,shared:1},{page:1,candidate:3,active:1,unknown:0,rejected:1,shared:1},{page:2,candidate:2,active:2,unknown:0,rejected:0,shared:1}
    ]);
    for(const summary of summaries){expect(summary.sharedFieldIds).toEqual(["shared"]);expect(summary.sharedFields).toEqual([{fieldId:"shared",pageIndices:[0,1,2]}]);}
    expect(input).toEqual(before);expect(input.document.pages.every(item=>item.review==="unseen")).toBe(true);expect(locked.native.originalReadOnly).toBe(true);
  });
  it("uses current task fields for counts while keeping the original analysis and its evidence unchanged",()=>{
    const source=analysis([field("one"),field("two")],[evidence("title","記入要領")]),current=[{...source.fields[0],mappingState:"rejected" as const}],before=structuredClone(source);
    const [summary]=derivePdfPageReviewSummaries(source,current);expect(summary).toMatchObject({candidateCount:1,activeCount:0,rejectedCount:1});expect(summary.hints[0]).toMatchObject({kind:"instructions-heading",evidenceIds:["title"],sourceExcerpt:"記入要領"});expect(source).toEqual(before);
  });
  it("reports original heading fragments only as possibilities and never propagates them to a continuation",()=>{
    const input=freeze(analysis([field("on-instructions"),field("on-following",1)],[evidence("source-title","【架空の申請書】記載要領"),evidence("next-body","№6について記載してください。",1,[60,500,450,514])],[page(),page(1)])),before=structuredClone(input);
    const summaries=derivePdfPageReviewSummaries(input);
    expect(summaries[0].hints).toEqual([{kind:"instructions-heading",message:expect.stringContaining("可能性"),evidenceIds:["source-title"],sourceExcerpt:"【架空の申請書】記載要領"}]);expect(summaries[1].hints).toEqual([]);expect(summaries[0].activeCount).toBe(1);expect(input).toEqual(before);
    expect(summaries[0]).not.toHaveProperty("purpose");expect(summaries[0]).not.toHaveProperty("confidence");
  });
  it("does not classify body references to examples as page headings or exclude a mixed form/example page",()=>{
    const bodyOnly=analysis([field("real-entry")],[evidence("body","記入例を参照して、本人の氏名を記入してください。",0,[60,200,450,214])]);expect(derivePdfPageReviewSummaries(bodyOnly)[0].hints).toEqual([]);
    const mixed=freeze(analysis([field("real-entry")],[evidence("example","記入例"),evidence("body","ここは本人の記入欄です。",0,[60,650,450,664])]));const [summary]=derivePdfPageReviewSummaries(mixed);
    expect(summary.hints[0]).toMatchObject({kind:"example-heading",evidenceIds:["example"]});expect(summary.activeCount).toBe(1);expect(mixed.fields[0].mappingState).toBe("confirmed");expect(mixed.document.pages[0].review).toBe("unseen");
  });
  it("keeps top-margin example references and imperative instructions out of heading hints without discarding the actual text or inputs",()=>{
    for(const sentence of ["記入例を参照して、本人の氏名を記入してください。","記入例を参照して本人の氏名を記入してください","記載要領を確認してから入力する","記入例は以下のとおりです"]){
      const input=freeze(analysis([field("real-entry")],[evidence("top-body",sentence)])),before=structuredClone(input);
      expect(derivePdfPageReviewSummaries(input)[0].hints).toEqual([]);expect(input).toEqual(before);
    }
    for(const title of ["記載要領","記入例","【架空の申請書】記載要領","記入例（参考）"]){
      const [summary]=derivePdfPageReviewSummaries(analysis([field("real-entry")],[evidence("actual-title",title)]));
      expect(summary.hints[0]).toMatchObject({evidenceIds:["actual-title"],sourceExcerpt:title});expect(summary.activeCount).toBe(1);
    }
  });
  it.each([
    [0,[140,950,400,962]],[90,[120,400,132,700]],[180,[200,225,500,237]],[270,[665,400,677,700]]
  ]as const)("locates a visual heading using rotated CropBox source coordinates at %d degrees",(rotation,box)=>{
    const rotated={...page(),visibleBox:[100,200,700,1000]as PdfBox,rotation};
    expect(derivePdfPageReviewSummaries(analysis([],[evidence("rotated","記入方法",0,[...box])],[rotated]))[0].hints[0]).toMatchObject({kind:"instructions-heading",evidenceIds:["rotated"]});
  });
  it("reports repeated numeric table facts, bounded raw excerpts and retained fields without assuming lookup-table purpose",()=>{
    const input=freeze(dense()),before=structuredClone(input),[summary]=derivePdfPageReviewSummaries(input);
    expect(summary).toMatchObject({candidateCount:80,activeCount:80,unknownCount:0,table:{numericOrMarkLabelCount:80,gridCellCount:80,gridRowCount:8,gridColumnCount:10,alignedRowCount:8,alignedColumnCount:10}});
    expect(summary.hints).toEqual([expect.objectContaining({kind:"dense-table",message:expect.stringContaining("参照表か記入用の表か")})]);expect(summary.hints[0].evidenceIds).toHaveLength(8);expect(summary.hints[0].sourceExcerpt!.length).toBeLessThanOrEqual(160);expect(input).toEqual(before);
  });
  it("retains every field of a genuinely writable dense checklist even when its shapes support the same hint",()=>{
    const input=freeze(dense(true)),before=structuredClone(input),[summary]=derivePdfPageReviewSummaries(input);
    expect(summary.hints.some(item=>item.kind==="dense-table")).toBe(true);expect(summary.activeCount).toBe(80);expect(summary.rejectedCount).toBe(0);expect(summary.unknownCount).toBe(0);expect(input.fields.every(item=>item.kind==="checkbox"&&item.mappingState==="confirmed")).toBe(true);expect(input.fields.every(item=>item.confidence.calibrationVersion===null)).toBe(true);expect(input).toEqual(before);
  });
  it("keeps dense layout facts but emits no source-backed hint for numeric current fields without actual original references",()=>{
    const source=dense();for(const item of source.fields)item.evidenceIds=["missing-original", "wrong-page"];
    source.evidence=[evidence("wrong-page","1",1)];source.document.pages.push(page(1));source.document.pageCount=2;
    const input=freeze(source),before=structuredClone(input),[summary]=derivePdfPageReviewSummaries(input);
    expect(summary.hints).toEqual([]);expect(summary.table).toMatchObject({numericOrMarkLabelCount:80,gridCellCount:80,alignedRowCount:8,alignedColumnCount:10});expect(summary.activeCount).toBe(80);expect(input).toEqual(before);
  });
  it("finds original support after the first eight numeric candidates and de-duplicates the bounded evidence across all fields",()=>{
    const source=dense();for(const item of source.fields)item.evidenceIds=[];source.evidence=[];
    for(let index=9;index<source.fields.length;index++){const id=`later-source-${index}`;source.fields[index].evidenceIds=index===9?[id,id]:[id];source.evidence.push(evidence(id,source.fields[index].label,0,source.fields[index].placements[0].quad.reduce<PdfBox>((box,point)=>[Math.min(box[0],point.x),Math.min(box[1],point.y),Math.max(box[2],point.x),Math.max(box[3],point.y)],[Infinity,Infinity,-Infinity,-Infinity])));}
    const input=freeze(source),[summary]=derivePdfPageReviewSummaries(input),denseHint=summary.hints.find(item=>item.kind==="dense-table")!;
    expect(denseHint.evidenceIds).toEqual(Array.from({length:8},(_,index)=>`later-source-${index+9}`));expect(denseHint.sourceExcerpt!.length).toBeLessThanOrEqual(160);expect(denseHint.evidenceIds.every(id=>input.evidence.some(item=>item.id===id&&item.pageIndex===0))).toBe(true);
  });
  it("does not call a large diagonal set or a single question with many options a dense question table",()=>{
    const diagonal=Array.from({length:80},(_,index)=>field(`diagonal-${index}`,0,String(index+1),[20+index*6,20+index*8,23+index*6,23+index*8]));expect(derivePdfPageReviewSummaries(analysis(diagonal))[0].hints).toEqual([]);
    const single=field("single",0,"□");single.placements=[];single.options=dense(true).fields.map(item=>({id:item.id,label:item.label,exportValue:item.id,placements:item.placements}));const [summary]=derivePdfPageReviewSummaries(analysis([single]));expect(summary.candidateCount).toBe(1);expect(summary.table.gridCellCount).toBe(80);expect(summary.hints).toEqual([]);
  });
  it("bounds multiple raw heading excerpts without turning low-confidence OCR text into a purpose claim",()=>{
    const text=Array.from({length:12},(_,index)=>evidence(`heading-${index}`,`記載要領${"あ".repeat(170)}`)),input=analysis([],text),[summary]=derivePdfPageReviewSummaries(input);
    expect(summary.hints[0].evidenceIds).toHaveLength(8);expect(summary.hints[0].sourceExcerpt!.length).toBeLessThanOrEqual(160);expect(summary.hints[0].sourceExcerpt).toBe(text[0].text.slice(0,160));
    const low={...evidence("low","記入例"),method:"ocr"as const,rawOcrConfidence:10};expect(derivePdfPageReviewSummaries(analysis([],[low]))[0].hints).toEqual([]);expect(low.text).toBe("記入例");
  });
});
