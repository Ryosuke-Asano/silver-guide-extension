import { makeManualPdfField, quadToBox, rectToQuad, type PdfBox, type PdfQuad, type PdfEvidence, type PdfField, type PdfRole } from "../../domain/pdf";
import { area, intersection, iou, overlaps, inverse, transformQuad } from "./geometry";

export function classifyLabel(label: string): {kind: PdfField["kind"];role:PdfRole;description:string} {
  const role:PdfRole=/役所|職員|処理欄|受付印|担当者記入|行政記入|決裁|整理番号/.test(label)?"office":/署名|自署|押印|印鑑/.test(label)?"signature":/代理人/.test(label)?"proxy":/法人|事業者|会社|団体/.test(label)?"organization":"unknown";
  const kind:PdfField["kind"]=role==="signature"?"signature":/生年月日|年月日|申請日|届出日|日付/.test(label)?"date":/チェック|該当|選択|同意|承諾/.test(label)?"checkbox":/金額|人数|数量|年齢/.test(label)?"number":/理由|備考|詳細|内容/.test(label)?"multiline":"text";
  const description=/ふりがな|フリガナ/.test(label)?"氏名の読み方を、原書類で指定されたひらがな・カタカナで入力します。":/住所|所在地/.test(label)?"原書類に指定された住所を入力します。番地や建物名も確認してください。":/電話/.test(label)?"連絡が取れる電話番号を入力します。":/生年月日/.test(label)?"生まれた年月日を、原書類の和暦・西暦の指定に合わせて入力します。":/氏名|名前/.test(label)?"この欄に記入する人を原書類で確認して、氏名を入力します。":"原書類の項目名と記入場所を確認してください。";
  return {kind,role,description};
}

/** Group adjacent native/OCR fragments without discarding contradictory text. */
export function mergeTextEvidence(items:PdfEvidence[]):PdfEvidence[] {
  const sorted=[...items].sort((a,b)=>a.pageIndex-b.pageIndex||quadToBox(b.quad)[1]-quadToBox(a.quad)[1]||quadToBox(a.quad)[0]-quadToBox(b.quad)[0]);
  const result:PdfEvidence[]=[];
  for(const item of sorted){if(!item.text.trim())continue;const box=quadToBox(item.quad);const duplicate=result.find(other=>other.pageIndex===item.pageIndex&&other.text.trim()===item.text.trim()&&iou(quadToBox(other.quad),box)>0.55);if(!duplicate)result.push(item);}
  return result;
}

function nearestLabel(box:PdfBox,evidence:PdfEvidence[],allowRight=false,allocations:PdfBox[]=[]):PdfEvidence|undefined {
  const ranked=evidence.flatMap(e=>{const b=quadToBox(e.quad),text=e.text.trim();if(text.length>80||/記入例|注意事項|説明書|。|これは|提出先/.test(text)||/^(?:[※*]\s*)?(?:必須|任意|省略可|required|optional)$/i.test(text)||e.method==="ocr"&&(e.rawOcrConfidence??0)<35)return [];
    // A value printed inside another answer allocation is not this field's label.
    if(allocations.some(other=>iou(other,box)<.8&&area(b)>0&&area(intersection(b,other))/area(b)>.6))return [];
    const left=b[2]<=box[0]+6&&overlaps(b,[box[0]-180,box[1]-4,box[0]+6,box[3]+4]);
    const above=b[1]>=box[3]-4&&b[1]-box[3]<40&&overlaps(b,[box[0]-10,box[3]-4,box[2]+10,box[3]+40]);
    const right=allowRight&&b[0]>=box[2]-4&&b[0]-box[2]<60&&overlaps(b,[box[2]-4,box[1]-4,box[2]+60,box[3]+4]);
    return left||right||above?[{e,rank:left||right?0:1,distance:labelDistance(box,b)}]:[];});
  return ranked.sort((a,b)=>a.rank-b.rank||a.distance-b.distance)[0]?.e;
}
function labelDistance(box:PdfBox,b:PdfBox){return Math.hypot(Math.max(0,box[0]-b[2],b[0]-box[2]),Math.max(0,b[1]-box[3]))+Math.abs((box[1]+box[3]-b[1]-b[3])/2)*0.3;}

/** Generic blank-box inference. Every uncalibrated field remains explicitly reviewable. */
export function inferFields(pageIndex:number, sourceBoxes:Array<PdfBox|PdfQuad>, evidence:PdfEvidence[],nativeFields:PdfField[]=[],userUnit=1,analysisRotation=0):PdfField[] {
  if(!Number.isFinite(userUnit)||userUnit<=0)throw new Error("INVALID_USER_UNIT");
  if(!Number.isFinite(analysisRotation))throw new Error("INVALID_ANALYSIS_ROTATION");
  const asQuad=(box:PdfBox|PdfQuad):PdfQuad=>typeof box[0]==="number"?rectToQuad(box as PdfBox):box as PdfQuad;
  if(userUnit!==1||analysisRotation!==0){const angle=analysisRotation*Math.PI/180,clean=(n:number)=>Math.abs(n)<1e-12?0:n,cs=clean(Math.cos(angle)),sn=clean(Math.sin(angle));const basis:import("../../domain/pdf").PdfAffine=[userUnit*cs,-userUnit*sn,userUnit*sn,userUnit*cs,0,0];const restore=inverse(basis);
    const scaledNative=nativeFields.map(f=>({...f,placements:f.placements.map(p=>({...p,quad:transformQuad(basis,p.quad)})),options:f.options.map(o=>({...o,placements:o.placements.map(p=>({...p,quad:transformQuad(basis,p.quad)}))}))}));
    const physical=inferFields(pageIndex,sourceBoxes.map(b=>quadToBox(transformQuad(basis,asQuad(b)))),evidence.map(e=>({...e,quad:transformQuad(basis,e.quad)})),scaledNative);
    return physical.map(f=>({...f,placements:f.placements.map(p=>({...p,quad:transformQuad(restore,p.quad),...(p.cells?{cells:p.cells.map(q=>transformQuad(restore,q))}:{})})),options:f.options.map(o=>({...o,placements:o.placements.map(p=>({...p,quad:transformQuad(restore,p.quad)}))}))}));
  }
  const boxes=sourceBoxes.map(b=>quadToBox(asQuad(b)));
  const pageText=evidence.filter(e=>e.pageIndex===pageIndex);
  const candidates:PdfBox[]=[],allBoxes:PdfBox[]=[],occupiedBoxes=new Set<PdfBox>();
  for(const box of boxes){const width=box[2]-box[0],height=box[3]-box[1];if(width<7||height<7||width>720||height>260||area(box)<60)continue;
    if(nativeFields.some(f=>f.placements.some(p=>p.pageIndex===pageIndex&&iou(quadToBox(p.quad),box)>0.35)))continue;
    if(allBoxes.some(b=>iou(b,box)>0.80))continue;
    const contained=pageText.filter(e=>(e.method!=="ocr"||(e.rawOcrConfidence??0)>=35)&&area(quadToBox(e.quad))>0&&area(intersection(quadToBox(e.quad),box))/area(quadToBox(e.quad))>.9);
    // Classify the printed content of this frame. Keep unrelated empty/native fields
    // even when the page also carries a no-input notice or a worked example.
    if(contained.some(e=>/^(?:見本|記入例|記載例)\s|ここ(?:には|に)?(?:回答|記入|入力)(?:しません|しない|不要)/.test(e.text.trim())))continue;
    const occupied=pageText.reduce((sum,e)=>{const b=quadToBox(e.quad);return sum+(e.text.trim().length>0&&(e.method!=="ocr"||(e.rawOcrConfidence??0)>=35)?area(intersection(b,box)):0);},0)/area(box)>.25;
    allBoxes.push(box);if(occupied)occupiedBoxes.add(box);else candidates.push(box);
  }
  const fields:PdfField[]=[];const used=new Set<PdfBox>();const groups:Array<{box:PdfBox;cells:PdfBox[]}>=[];
  for(const first of [...allBoxes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])){if(used.has(first))continue;const w=first[2]-first[0],h=first[3]-first[1];if(w>35||h>40||w<10||h<10)continue;const row=allBoxes.filter(b=>!used.has(b)&&Math.abs(b[1]-first[1])<1.5&&Math.abs(b[3]-first[3])<1.5&&Math.abs((b[2]-b[0])-w)<2).sort((a,b)=>a[0]-b[0]);const cells:PdfBox[]=[];for(const b of row){if(!cells.length)cells.push(b);else if(b[0]-cells[cells.length-1][2]>=-1&&b[0]-cells[cells.length-1][2]<4)cells.push(b);else if(cells.length<3){cells.length=0;cells.push(b);}else break;}if(cells.length>=3&&cells.some(b=>!occupiedBoxes.has(b))){cells.forEach(b=>used.add(b));groups.push({box:[cells[0][0],cells[0][1],cells[cells.length-1][2],cells[0][3]],cells});}}
  const allocations=[...groups.map(g=>g.box),...candidates.filter(b=>!used.has(b))];
  for(const candidate of [...groups,...candidates.filter(b=>!used.has(b)).map(box=>({box,cells:[] as PdfBox[]}))]){const {box,cells}=candidate;if(nativeFields.some(f=>[...f.placements,...f.options.flatMap(o=>o.placements)].some(p=>p.pageIndex===pageIndex&&iou(quadToBox(p.quad),box)>.35)))continue;const tiny=!cells.length&&box[2]-box[0]<24&&box[3]-box[1]<24;const label=nearestLabel(box,pageText,tiny,allocations);const labelText=label?.text.trim()||"記入欄（項目名を確認）";const classification=classifyLabel(labelText);
    const field=makeManualPdfField(pageIndex,box,labelText,tiny?"checkbox":classification.kind);field.source="inferred";field.mappingState="needs-review";field.role=classification.role;field.description=classification.description;field.conditionStatus=/場合|のみ|該当.*方|とき/.test(labelText)?"unknown":"unconditional";field.readOnly=classification.role==="office"||classification.role==="signature";field.evidenceIds=label?[label.id]:[];fields.push(field);
    if(cells.length){const writingCells=cells.filter(cell=>!pageText.some(e=>{const b=quadToBox(e.quad),text=e.text.trim();return (e.method!=="ocr"||(e.rawOcrConfidence??0)>=35)&&area(b)>0&&area(intersection(b,cell))/area(b)>.9&&(/^(?:年|月|日|時|分|円|人|名|歳|〒)$/.test(text)||text===labelText);}));
      if(!writingCells.length){fields.pop();continue;}field.placements[0].cells=writingCells.map(rectToQuad);field.maxGraphemes=writingCells.length;}
  }
  // Underlines following labels are another common administrative-form convention.
  for(const e of pageText){const match=e.text.match(/^(.{1,50}?)[：:]?\s*[_＿]{3,}\s*$/);if(!match)continue;const b=quadToBox(e.quad);const label=match[1].trim();const fraction=match[1].length/e.text.length;const box:PdfBox=[b[0]+(b[2]-b[0])*fraction,b[1]-2,b[2],b[3]+7];if([...fields,...nativeFields].some(f=>[...f.placements,...f.options.flatMap(o=>o.placements)].some(p=>p.pageIndex===pageIndex&&iou(quadToBox(p.quad),box)>.3)))continue;const f=makeManualPdfField(pageIndex,box,label);Object.assign(f,{source:"inferred",mappingState:"needs-review",...classifyLabel(label),evidenceIds:[e.id]});fields.push(f);}
  return fields.sort((a,b)=>quadToBox(b.placements[0].quad)[3]-quadToBox(a.placements[0].quad)[3]||quadToBox(a.placements[0].quad)[0]-quadToBox(b.placements[0].quad)[0]);
}

/** Detect axis-aligned box boundaries from a raster, reducing long page images to bounded analysis. */
export function detectRasterBoxes(data:Uint8ClampedArray,width:number,height:number):PdfBox[] {
  const step=Math.max(1,Math.ceil(Math.max(width,height)/1800));const w=Math.floor(width/step),h=Math.floor(height/step);const dark=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let ink=0;for(let sy=0;sy<step&&!ink;sy++)for(let sx=0;sx<step;sx++){const i=((y*step+sy)*width+x*step+sx)*4;if(data[i]*.299+data[i+1]*.587+data[i+2]*.114<185&&data[i+3]>100){ink=1;break;}}dark[y*w+x]=ink;}
  const horizontal:Array<{x0:number;x1:number;y:number}>=[];const vertical:Array<{y0:number;y1:number;x:number}>=[];
  for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){if(x<w&&dark[y*w+x]){if(start<0)start=x;}else if(start>=0){if(x-start>=14)horizontal.push({x0:start,x1:x-1,y});start=-1;}}}
  for(let x=0;x<w;x++){let start=-1;for(let y=0;y<=h;y++){if(y<h&&dark[y*w+x]){if(start<0)start=y;}else if(start>=0){if(y-start>=7)vertical.push({y0:start,y1:y-1,x});start=-1;}}}
  const hs=horizontal.filter((line,i)=>!horizontal.slice(Math.max(0,i-30),i).some(p=>Math.abs(p.y-line.y)<3&&Math.abs(p.x0-line.x0)<3&&Math.abs(p.x1-line.x1)<3));
  const result:PdfBox[]=[];
  for(let i=0;i<hs.length;i++){const top=hs[i];for(let j=i+1;j<hs.length&&j<i+100;j++){const bottom=hs[j];if(bottom.y-top.y<7||bottom.y-top.y>220)continue;
    const left=Math.max(top.x0,bottom.x0),right=Math.min(top.x1,bottom.x1);if(right-left<14)continue;
    const sides=vertical.filter(v=>v.y0<=top.y+3&&v.y1>=bottom.y-3&&v.x>=left-3&&v.x<=right+3).sort((a,b)=>a.x-b.x);
    for(let k=0;k<sides.length-1;k++){const l=sides[k].x,r=sides[k+1].x;if(r-l<7)continue;
      // Keep elementary cells. A full internal rule splits the proposed box;
      // partial rules still permit genuine merged cells. This also prevents
      // Japanese glyphs such as 自 from becoming one checkbox over three holes.
      if(hs.some(line=>line.y>top.y+3&&line.y<bottom.y-3&&line.x0<=l+3&&line.x1>=r-3))continue;
      const box:PdfBox=[l*step,top.y*step,r*step,bottom.y*step];if(!result.some(b=>iou(b,box)>.85))result.push(box);if(result.length>=5000)return result;}
  }}return result;
}

