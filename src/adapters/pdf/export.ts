import fontkit from "@pdf-lib/fontkit";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, PDFRef, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PDF_MAX_OUTPUT_BYTES, PdfEngineError, pdfFieldApplicability,pdfFieldReadOnly,pdfFieldSourceReadOnly, quadToBox, type PdfAnswer, type PdfExportOptions, type PdfField, type PdfIssue, type PdfPageInfo, type PdfPlacement, type PdfPoint } from "../../domain/pdf";
import { abortIfNeeded, graphemes, isInside } from "./geometry";
import { extractNativeFields, inspectNativeDocument, sanitizePdf } from "./native";
import { area, intersection } from "./geometry";
import { validatePdfFields } from "./validation";

export type BuildExportInput={inputMode?:"direct";original:Uint8Array;pages:PdfPageInfo[];fields:PdfField[];answers:PdfExportOptions["answers"];answerStatus?:Record<string,string>;mode:NonNullable<PdfExportOptions["mode"]>;fontBytes:Uint8Array;allowIncomplete:boolean;actionRemovalConfirmed:boolean};
const textBounds=new WeakMap<PDFFont,(text:string)=>{ascent:number;descent:number}>();
/** TrueType subsets retain actual Japanese outlines; CFF uses the verified full-font fallback. */
export async function embedJapaneseFont(doc:PDFDocument,bytes:Uint8Array):Promise<PDFFont>{
  const trueType=bytes.length>4&&bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0;
  const parsed=fontkit.create(bytes) as ReturnType<typeof fontkit.create>&{variationAxes?:Record<string,unknown>};
  if(parsed.variationAxes&&Object.keys(parsed.variationAxes).length)throw new PdfEngineError("VARIABLE_FONT_UNSUPPORTED","可変フォントは静的な書き出し用フォントへ変換してから利用してください。");
  doc.registerFontkit({create:()=>parsed});const embedded=await doc.embedFont(bytes,{subset:trueType});textBounds.set(embedded,text=>{const run=parsed.layout(text.replace(/[\r\n]/g,""));let ascent=0,descent=0;for(let index=0;index<run.glyphs.length;index++){const box=run.glyphs[index].bbox,offset=run.positions[index]?.yOffset??0;if(Number.isFinite(box.maxY))ascent=Math.max(ascent,box.maxY+offset);if(Number.isFinite(box.minY))descent=Math.min(descent,box.minY+offset);}return {ascent:ascent/parsed.unitsPerEm,descent:descent/parsed.unitsPerEm};});return embedded;
}
export type BuildExportResult={bytes:Uint8Array;issues:PdfIssue[];written:Array<{fieldId:string;value:PdfAnswer;nativeName:string|null;texts:string[]}>};
const isEmpty=(value:PdfAnswer|undefined)=>value===null||value===undefined||value===""||(Array.isArray(value)&&value.length===0);
const answerText=(value:PdfAnswer):string=>typeof value==="string"?value:Array.isArray(value)?value.join("、"):value===true?"✓":"";
const issue=(code:string,message:string,field?:PdfField):PdfIssue=>({code,message,fieldId:field?.id,severity:"error"});
const dist=(a:PdfPoint,b:PdfPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
function fieldInset(width:number,height:number,userUnit:number):number{return Math.min(2/userUnit,Math.min(width,height)*.06);}

function validateInput(input:BuildExportInput,doc:PDFDocument):PdfIssue[]{
  const errors:PdfIssue[]=validatePdfFields(input.fields,input.answers,input.pages,{allowIncomplete:input.allowIncomplete,answerStatus:input.answerStatus,inputMode:input.inputMode});const ids=new Set<string>();const existingFields=doc.getForm().getFields(),originalFields=extractNativeFields(doc).fields,sourceConstraints=new Map(originalFields.map(field=>[field.native!.fieldRef,field]));const protectedPlacements=originalFields.filter(pdfFieldReadOnly).flatMap(f=>f.placements);
  for(const field of input.fields){if(ids.has(field.id)){errors.push(issue("DUPLICATE_FIELD","同じ項目が重複しています。",field));continue;}ids.add(field.id);const value=Object.prototype.hasOwnProperty.call(input.answers,field.id)?input.answers[field.id]:field.initialValue;
    if(pdfFieldApplicability(field,input.answers,{answerStatus:input.answerStatus})===false)continue;
    const native=field.native?existingFields.find(f=>f.ref.toString()===field.native!.fieldRef):undefined;
    if(field.native&&!native){errors.push(issue("NATIVE_FIELD_MISMATCH","原書類の入力欄が変更されています。",field));continue;}
    if(input.inputMode!=="direct"&&native&&field.required!=="unknown"&&field.required!==native.isRequired()&&(field.requiredSource?.kind!=="document"||!field.requiredSource.text.trim()))errors.push(issue("REQUIRED_SOURCE_UNCONFIRMED","元PDFの必須指定を変更する場合は原書類の文章の根拠が必要です。",field));
    if(field.mappingState==="rejected")continue;
    const originalField=native?sourceConstraints.get(native.ref.toString()):null;
    if(native?.isReadOnly()||originalField&&pdfFieldSourceReadOnly(originalField)){if(!originalField||JSON.stringify(value)!==JSON.stringify(originalField.initialValue))errors.push(issue("READ_ONLY_FIELD",`「${field.label}」は記入対象ではありません。`,field));continue;}
    if(isEmpty(value))continue;
    if(!field.native&&value!==false)for(const p of field.placements){const b=quadToBox(p.quad);if(protectedPlacements.some(protectedPlacement=>protectedPlacement.pageIndex===p.pageIndex&&area(intersection(b,quadToBox(protectedPlacement.quad)))>Math.min(area(b),area(quadToBox(protectedPlacement.quad)))*.2))errors.push(issue("PROTECTED_NATIVE_OVERLAP","追加した記入枠が、署名欄や原書類の読み取り専用欄に重なっています。",field));}
    const unchanged=JSON.stringify(value)===JSON.stringify(field.initialValue);
    if(pdfFieldReadOnly(field)){if(!unchanged)errors.push(issue("READ_ONLY_FIELD",`「${field.label}」は記入対象ではありません。`,field));continue;}
    if(input.inputMode!=="direct"&&field.role==="unknown")errors.push(issue("ROLE_UNCONFIRMED",`「${field.label}」の記入者を確認してください。`,field));
    if(input.inputMode!=="direct"&&!["confirmed","manual"].includes(field.mappingState))errors.push(issue("MAPPING_UNCONFIRMED",`「${field.label}」の項目名と記入場所を確認してください。`,field));
    if(!field.placements.length)errors.push(issue("PLACEMENT_MISSING",`「${field.label}」の記入場所がありません。`,field));
    const text=answerText(value);if(field.maxGraphemes!==null&&graphemes(text).length>field.maxGraphemes)errors.push(issue("GRAPHEME_LIMIT",`「${field.label}」は ${field.maxGraphemes} 文字までです。`,field));
    if(native instanceof PDFTextField&&native.getMaxLength()!==undefined&&text.length>native.getMaxLength()!)errors.push(issue("NATIVE_LENGTH_LIMIT",`「${field.label}」の PDF 入力欄の文字数制限に収まりません。`,field));
    if(field.kind==="unknown"||field.kind==="signature")errors.push(issue("FIELD_TYPE_UNSUPPORTED",`「${field.label}」の項目型を確認してください。`,field));
    for(const placement of field.placements){const page=input.pages[placement.pageIndex];if(!page||!isInside(placement.quad,page.visibleBox))errors.push(issue("INVALID_PLACEMENT",`「${field.label}」が用紙の外にあります。`,field));}
    if((field.kind==="radio"||field.kind==="select")&&!field.native){for(const selected of Array.isArray(value)?value:[String(value)]){const option=field.options.find(o=>o.id===selected||o.exportValue===selected);if(!option||!option.placements.length)errors.push(issue("OPTION_PLACEMENT_MISSING",`「${field.label}」の選択肢の記入場所を確認してください。`,field));}}
  }return errors;
}

/** Width fitting never drops characters or silently goes below the physical 10pt floor. */
export function fitText(text:string,font:Pick<PDFFont,"widthOfTextAtSize"|"heightAtSize">,width:number,height:number,options:{fontSize:number;minSize:number;multiline:boolean}):{size:number;lines:string[]}{
  for(let size=options.fontSize;size>=options.minSize-.01;size-=.25){const lines:string[]=[];let current="";
    for(const char of graphemes(text)){if(char==="\n"){if(!options.multiline)throw new PdfEngineError("MULTILINE_NOT_ALLOWED","改行を含む回答が一行の欄に指定されています。");lines.push(current);current="";continue;}if(font.widthOfTextAtSize(current+char,size)>width){if(!options.multiline||!current){current="";lines.length=0;break;} // prevent prohibited punctuation at the start of the next line
        if(/^[、。，．）］｝」』】〕〉》！？：；]/.test(char)&&graphemes(current).length>1){const chars=graphemes(current);const last=chars.pop()!;lines.push(chars.join(""));current=last+char;}else{lines.push(current);current=char;}}
      else current+=char;
    }
    if(current||text==="")lines.push(current);const inkHeight=font.heightAtSize(size),neededHeight=inkHeight+Math.max(0,lines.length-1)*inkHeight*1.3;if(lines.length&&lines.every(line=>font.widthOfTextAtSize(line,size)<=width+.01)&&neededHeight<=height+.01)return {size,lines};
  }throw new PdfEngineError("TEXT_DOES_NOT_FIT","文字が記入枠に収まりません。枠や文字サイズを確認してください。");
}

function drawCheck(page:PDFPage,placement:PdfPlacement,userUnit:number){const q=placement.quad;const point=(x:number,y:number)=>({x:q[0].x+(q[1].x-q[0].x)*x+(q[3].x-q[0].x)*y,y:q[0].y+(q[1].y-q[0].y)*x+(q[3].y-q[0].y)*y});page.drawLine({start:point(.18,.5),end:point(.43,.23),thickness:1.4/userUnit,color:rgb(0,0,0)});page.drawLine({start:point(.43,.23),end:point(.82,.79),thickness:1.4/userUnit,color:rgb(0,0,0)});}

function drawAnswer(page:PDFPage,placement:PdfPlacement,text:string,font:PDFFont,field:PdfField,pageInfo:PdfPageInfo):string[]{
  const unit=pageInfo.userUnit||1,q=placement.quad,padding=fieldInset(dist(q[0],q[1]),dist(q[0],q[3]),unit),width=dist(q[0],q[1])-padding*2,height=dist(q[0],q[3])-padding*2;const angle=Math.atan2(q[1].y-q[0].y,q[1].x-q[0].x),c=Math.cos(angle),s=Math.sin(angle);const point=(x:number,y:number)=>({x:q[0].x+x*c-y*s,y:q[0].y+x*s+y*c});const physicalSize=field.style?.fontSizePt??14,minSize=field.style?.allowSmallFont?physicalSize:10;
  if(physicalSize<10&&!field.style?.allowSmallFont)throw new PdfEngineError("SMALL_FONT_UNCONFIRMED","小さい文字サイズを使う場合は、拡大プレビューで確認してください。");
  if(placement.cells?.length){const chars=graphemes(text);if(chars.length>placement.cells.length)throw new PdfEngineError("CELL_OVERFLOW","回答がマス目の数を超えています。");for(let i=0;i<chars.length;i++)drawAnswer(page,{...placement,quad:placement.cells[i],cells:undefined},chars[i],font,{...field,kind:"text",style:{...field.style,alignment:"center"}},pageInfo);return chars;}
  if(placement.writingMode==="vertical"){const chars=graphemes(text);let size=physicalSize/unit;const minimum=minSize/unit;while(size>=minimum&&((font.heightAtSize(size)*1.25)*chars.length>height||font.widthOfTextAtSize("漢",size)>width))size-=.25/unit;if(size<minimum)throw new PdfEngineError("TEXT_DOES_NOT_FIT","縦書きの記入枠に収まりません。");for(let i=0;i<chars.length;i++){const char=chars[i],p=point(padding+(width-font.widthOfTextAtSize(char,size))/2,padding+height-size*(i+1)*1.25);const rotate=/^[ー―…（）「」『』［］｛｝]$/.test(char)?90:0;page.drawText(char,{...p,font,size,rotate:degrees(angle*180/Math.PI+rotate),color:rgb(0,0,0)});}return chars;}
  const bounds=textBounds.get(font)?.(text),metricFont=bounds?{widthOfTextAtSize:font.widthOfTextAtSize.bind(font),heightAtSize:(size:number)=>(bounds.ascent-bounds.descent)*size}:font;const layout=fitText(text,metricFont,width,height,{fontSize:physicalSize/unit,minSize:minSize/unit,multiline:field.kind==="multiline"});const lineHeight=metricFont.heightAtSize(layout.size)*1.3,ascent=bounds?bounds.ascent*layout.size:font.heightAtSize(layout.size);
  for(let i=0;i<layout.lines.length;i++){const line=layout.lines[i],lineWidth=font.widthOfTextAtSize(line,layout.size);const align=field.style?.alignment;const x=padding+(align==="center"?(width-lineWidth)/2:align==="right"?width-lineWidth:0);const p=point(x,padding+height-ascent-i*lineHeight);page.drawText(line,{...p,size:layout.size,font,rotate:degrees(angle*180/Math.PI),color:rgb(0,0,0)});}return layout.lines;
}

export async function buildPdfExport(input:BuildExportInput,signal?:AbortSignal,onProgress?:(completed:number,total:number,detail:string)=>void):Promise<BuildExportResult>{
  const total=input.fields.length+4;onProgress?.(0,total,"原書類の構造を確認しています");
  abortIfNeeded(signal);const doc=await PDFDocument.load(input.original.slice(),{updateMetadata:false});const inspection=inspectNativeDocument(doc);if(inspection.encrypted||inspection.signed||inspection.xfa||inspection.unsupportedActive)throw new PdfEngineError("DOCUMENT_READ_ONLY","この PDF は書き出しに対応していません。",inspection.issues);
  if(inspection.actionDependent&&(input.mode!=="print"||!input.actionRemovalConfirmed))throw new PdfEngineError("ACTION_CONFIRMATION_REQUIRED","計算・検証処理を持つ原書類は、影響を確認した印刷用出力だけを利用できます。",inspection.issues);
  const errors=validateInput(input,doc);if(errors.length)throw new PdfEngineError("ANSWERS_INVALID","記入する項目を確認してください。",errors);
  onProgress?.(1,total,"日本語の書き出しフォントを準備しています");const font=await embedJapaneseFont(doc,input.fontBytes);const supported=new Set(font.getCharacterSet());const form=doc.getForm(),sourceConstraints=new Map(extractNativeFields(doc).fields.map(field=>[field.native!.fieldRef,field]));const written:BuildExportResult["written"]=[];const issues:PdfIssue[]=[];let processed=0;
  for(const field of input.fields){abortIfNeeded(signal);onProgress?.(2+processed++,total,"記入欄へ回答を配置しています");const value=Object.prototype.hasOwnProperty.call(input.answers,field.id)?input.answers[field.id]:field.initialValue;if(pdfFieldReadOnly(field)||field.mappingState==="rejected"||!field.native&&pdfFieldApplicability(field,input.answers,{answerStatus:input.answerStatus})===false)continue;const text=answerText(value);if(!isEmpty(value)&&!["checkbox","radio","select"].includes(field.kind))for(const char of Array.from(text)){if(char==="\n"||char==="\r")continue;if(!supported.has(char.codePointAt(0)!))throw new PdfEngineError("GLYPH_UNAVAILABLE",`「${field.label}」の文字「${char}」を同梱フォントで表示できません。`,[issue("GLYPH_UNAVAILABLE","表示できない文字があります。",field)]);}
    if(field.native){const native=form.getFields().find(f=>f.ref.toString()===field.native!.fieldRef);if(!native)throw new PdfEngineError("NATIVE_FIELD_MISMATCH","入力欄が見つかりません。");const original=sourceConstraints.get(native.ref.toString());if(native.isReadOnly()||!original||pdfFieldSourceReadOnly(original))continue;
      const widgets=native.acroField.getWidgets();for(let wi=0;wi<widgets.length;wi++){const placement=field.placements[wi];if(!placement)throw new PdfEngineError("WIDGET_MAPPING_MISSING","原書類の入力欄の配置が不足しています。");const widget=widgets[wi],box=quadToBox(placement.quad);widget.setRectangle({x:box[0],y:box[1],width:box[2]-box[0],height:box[3]-box[1]});const previous=doc.getPages().find(p=>p.ref.toString()===widget.P()?.toString()),target=doc.getPage(placement.pageIndex);if(previous&&previous!==target){const refEntry=doc.context.enumerateIndirectObjects().find(([,object])=>object===widget.dict);const ref=refEntry?.[0]??native.ref;const annotations=previous.node.Annots();if(annotations)for(let ai=annotations.size()-1;ai>=0;ai--)if(annotations.get(ai).toString()===ref.toString())annotations.remove(ai);target.node.addAnnot(ref);widget.setP(target.ref);}}
      if(native instanceof PDFTextField){native.setText(isEmpty(value)?"":text);if(!isEmpty(value)){for(let wi=0;wi<widgets.length;wi++){const p=field.placements[wi],b=quadToBox(p.quad),unit=input.pages[p.pageIndex].userUnit;const size=fitText(text,font,b[2]-b[0]-4/unit,b[3]-b[1]-4/unit,{fontSize:(field.style?.fontSizePt??14)/unit,minSize:(field.style?.allowSmallFont?(field.style.fontSizePt??10):10)/unit,multiline:native.isMultiline()}).size;widgets[wi].setDefaultAppearance(`/${font.name} ${size} Tf 0 g`);}}native.updateAppearances(font);}
      else if(native instanceof PDFCheckBox){if(value===true)native.check();else native.uncheck();}
      else if(native instanceof PDFRadioGroup){if(isEmpty(value))native.clear();else native.select(String(value));}
      else if(native instanceof PDFDropdown||native instanceof PDFOptionList){if(isEmpty(value))native.clear();else native.select(Array.isArray(value)?value:String(value));native.updateAppearances(font);}
      else if(!isEmpty(value))throw new PdfEngineError("NATIVE_TYPE_UNSUPPORTED","この入力欄の型は書き出せません。");written.push({fieldId:field.id,value,nativeName:field.native.name,texts:[text]});
    }else if(!isEmpty(value)){const texts:string[]=[];if(field.kind==="checkbox"){if(value===true||value==="true")for(const placement of field.placements)drawCheck(doc.getPage(placement.pageIndex),placement,input.pages[placement.pageIndex].userUnit);}
      else if(field.kind==="radio"||field.kind==="select"){for(const selected of Array.isArray(value)?value:[String(value)]){const option=field.options.find(o=>o.id===selected||o.exportValue===selected)!;for(const placement of option.placements)drawCheck(doc.getPage(placement.pageIndex),placement,input.pages[placement.pageIndex].userUnit);}}
      else for(const placement of field.placements)try{texts.push(...drawAnswer(doc.getPage(placement.pageIndex),placement,text,font,field,input.pages[placement.pageIndex]));}catch(error){if(error instanceof PdfEngineError){error.issues.push(issue(error.code,error.message,field));}throw error;}written.push({fieldId:field.id,value,nativeName:null,texts});}
  }
  onProgress?.(total-1,total,"PDFの記入結果を保存形式へまとめています");if(input.mode==="print")form.flatten({updateFieldAppearances:true});sanitizePdf(doc);abortIfNeeded(signal);const bytes=await doc.save({updateFieldAppearances:false});if(bytes.byteLength>PDF_MAX_OUTPUT_BYTES)throw new PdfEngineError("OUTPUT_BYTE_LIMIT","作成する PDF は 160MiB 以下にしてください。");abortIfNeeded(signal);onProgress?.(total,total,"記入データを作成しました");return {bytes,issues,written};
}

