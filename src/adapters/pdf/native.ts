import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFNumber, PDFObject, PDFOptionList, PDFRadioGroup, PDFRef, PDFSignature, PDFStream, PDFString, PDFTextField } from "pdf-lib";
import { rectToQuad, type PdfBox, type PdfField, type PdfIssue, type PdfPlacement } from "../../domain/pdf";
import { classifyLabel } from "./structure";
import type {PDFDocumentProxy} from "pdfjs-dist/types/src/display/api";
import {makeManualPdfField,quadToBox,type PdfAnswer} from "../../domain/pdf";

export type DocumentInspection = { encrypted:boolean; signed:boolean; xfa:boolean; actionDependent:boolean; activeActions:boolean; unsupportedActive:boolean; issues:PdfIssue[] };
const name=(value:unknown)=>value instanceof PDFName?value.decodeText():"";
export function stringValue(value:unknown):string { return value instanceof PDFString||value instanceof PDFHexString?value.decodeText():""; }

/** Inspect the parsed object graph; byte substring searches are not a security boundary. */
export function visitObjects(doc:PDFDocument,visitor:(object:PDFDict)=>void):void {
  const seen=new Set<PDFObject>();let nodes=0;
  const visit=(raw:PDFObject|undefined)=>{if(!raw)return;const object=raw instanceof PDFRef?doc.context.lookup(raw):raw;if(!object||seen.has(object))return;seen.add(object);if(++nodes>250000)throw new Error("OBJECT_LIMIT");
    if(object instanceof PDFStream){visit(object.dict);return;}if(object instanceof PDFDict){visitor(object);for(const [,value] of object.entries())visit(value);}else if(object instanceof PDFArray){for(let i=0;i<object.size();i++)visit(object.get(i));}};
  visit(doc.catalog);
}

export function inspectNativeDocument(doc:PDFDocument):DocumentInspection {
  const result:DocumentInspection={encrypted:doc.isEncrypted,signed:false,xfa:false,actionDependent:false,activeActions:false,unsupportedActive:false,issues:[]};
  const acro=doc.catalog.lookup(PDFName.of("AcroForm"));if(acro instanceof PDFDict){result.xfa=acro.has(PDFName.of("XFA"));const co=acro.lookup(PDFName.of("CO"));result.actionDependent=co instanceof PDFArray&&co.size()>0;}
  visitObjects(doc,dict=>{
    const type=name(dict.lookup(PDFName.of("Type"))),subtype=name(dict.lookup(PDFName.of("Subtype"))),action=name(dict.lookup(PDFName.of("S")));
    if(type==="Sig"||dict.has(PDFName.of("ByteRange")))result.signed=true;
    if(dict.has(PDFName.of("AA"))){result.activeActions=true;if(dict.has(PDFName.of("FT"))||subtype==="Widget")result.actionDependent=true;}
    if(dict.has(PDFName.of("OpenAction"))||dict.has(PDFName.of("JS"))||dict.has(PDFName.of("AF")))result.activeActions=true;
    if(action&&["JavaScript","Launch","SubmitForm","ImportData","GoToR","GoToE","Rendition","Sound","Movie"].includes(action))result.activeActions=true;
    if(action&&!['JavaScript','Launch','SubmitForm','ImportData','GoToR','GoToE','Rendition','Sound','Movie','URI','GoTo','Named','Hide','SetOCGState','ResetForm','Trans'].includes(action)&&dict.has(PDFName.of("S"))&&dict.has(PDFName.of("Next")))result.unsupportedActive=true;
    if(["RichMedia","3D","Movie","Sound","Screen"].includes(subtype))result.unsupportedActive=true;
  });
  if(result.signed)result.issues.push({code:"SIGNED_READ_ONLY",message:"電子署名があるため、元の署名を保持して記入することはできません。読み取りだけを行います。",severity:"warning"});
  if(result.xfa)result.issues.push({code:"XFA_READ_ONLY",message:"XFA のフォームは読み取り専用です。",severity:"warning"});
  if(result.actionDependent)result.issues.push({code:"ACTION_DEPENDENT",message:"このフォームには計算・検証処理があります。電子提出用に保存できません。原書類の計算結果を確認した印刷用出力だけを利用できます。",severity:"warning"});
  if(result.unsupportedActive)result.issues.push({code:"UNSUPPORTED_ACTIVE_CONTENT",message:"対応していない能動的な PDF 構造があるため、書き出せません。",severity:"error"});
  return result;
}

/** Remove reachable active actions while retaining explicit HTTP(S) links and static appearances. */
export function sanitizePdf(doc:PDFDocument):void {
  visitObjects(doc,dict=>{
    for(const key of ["OpenAction","AA","JS","AF","CO"])dict.delete(PDFName.of(key));
    const a=dict.lookup(PDFName.of("A"));if(a instanceof PDFDict){const s=name(a.lookup(PDFName.of("S")));const uri=stringValue(a.lookup(PDFName.of("URI")));if(s!=="URI"||!/^https?:\/\//i.test(uri))dict.delete(PDFName.of("A"));else a.delete(PDFName.of("Next"));}
    const names=dict.lookup(PDFName.of("Names"));if(names instanceof PDFDict){names.delete(PDFName.of("JavaScript"));names.delete(PDFName.of("EmbeddedFiles"));}
    if(name(dict.lookup(PDFName.of("Subtype")))==="FileAttachment"){dict.delete(PDFName.of("FS"));dict.set(PDFName.of("Subtype"),PDFName.of("Text"));}
  });
}

export function nativePageBoxes(doc:PDFDocument,pageIndex:number):{mediaBox:PdfBox;cropBox:PdfBox} {
  const page=doc.getPage(pageIndex),media=page.getMediaBox(),crop=page.getCropBox();return {mediaBox:[media.x,media.y,media.x+media.width,media.y+media.height],cropBox:[crop.x,crop.y,crop.x+crop.width,crop.y+crop.height]};
}

/** Read-only annotation metadata when the writer cannot open encrypted bytes.
 * References identify original widget objects. They are never writer references.
 */
export async function extractReadOnlyNativeFields(pdf:PDFDocumentProxy):Promise<PdfField[]>{
  const fields=new Map<string,PdfField>();for(let pageIndex=0;pageIndex<pdf.numPages;pageIndex++){const page=await pdf.getPage(pageIndex+1);try{for(const data of await page.getAnnotations({intent:"display"})){
    if(data.subtype!=="Widget"||typeof data.fieldName!=="string"||!Array.isArray(data.rect)||data.rect.length!==4)continue;const match=String(data.id).match(/^(\d+)R(?:(\d+))?$/);if(!match)continue;const reference=`${match[1]} ${match[2]??0} R`,key=data.fieldName;let field=fields.get(key);
    const placement:PdfPlacement={pageIndex,quad:rectToQuad(data.rect as PdfBox),widgetRef:reference,writingMode:"horizontal"};if(!field){const label=data.alternativeText||key,classification=classifyLabel(label);let kind:PdfField["kind"]="unknown";if(data.fieldType==="Tx")kind=data.multiLine?"multiline":classification.kind;else if(data.fieldType==="Ch")kind="select";else if(data.checkBox)kind="checkbox";else if(data.radioButton)kind="radio";else if(data.fieldType==="Sig")kind="signature";
      const raw=data.fieldValue;const initial:PdfAnswer=kind==="checkbox"?Boolean(raw&&raw!=="Off"):typeof raw==="string"?raw:Array.isArray(raw)&&raw.every(item=>typeof item==="string")?raw:null;field={...makeManualPdfField(pageIndex,quadToBox(placement.quad),label,kind),source:"acroform",description:classification.description,role:kind==="signature"?"signature":classification.role,readOnly:true,mappingState:"needs-review",required:Boolean(data.required),requiredEvidenceIds:[`native:${reference}:Ff`],requiredSource:{kind:"native",text:data.required?"原 PDF の入力欄に必須フラグが指定されています。この文書は読み取り専用です。":"原 PDF の入力欄には必須フラグがありません。文章にある条件も確認してください。この文書は読み取り専用です。",pageIndex},conditionStatus:/場合|のみ|該当.*方|とき/.test(label)?"unknown":"unconditional",initialValue:initial,native:{name:key,fieldRef:reference,referenceKind:"read-only-widget",widgetRefs:[],maxLength:Number.isInteger(data.maxLen)&&data.maxLen>=0?data.maxLen:null,lengthUnit:"utf16-code-unit",multiSelect:Boolean(data.multiSelect),editableSelect:Boolean(data.combo&&(Number(data.fieldFlags)&(1<<18))),originalRequired:Boolean(data.required),originalReadOnly:Boolean(data.readOnly),unsupported:kind==="unknown"||Boolean(data.password)||Boolean(Number(data.fieldFlags)&(1<<20))},placements:[],options:Array.isArray(data.options)?data.options.map((option:{exportValue:string;displayValue:string})=>({id:option.exportValue,label:option.displayValue,exportValue:option.exportValue,placements:[]})):[]};fields.set(key,field);
    }field.placements.push(placement);field.native!.widgetRefs.push(reference);if(data.radioButton&&typeof data.buttonValue==="string"){let option=field.options.find(item=>item.exportValue===data.buttonValue);if(!option){option={id:data.buttonValue,label:data.buttonValue,exportValue:data.buttonValue,placements:[]};field.options.push(option);}option.placements.push(placement);}
  }}finally{page.cleanup();}}return [...fields.values()];
}

/** Inspect declared dimensions before PDF.js can suppress a resource image. */
export function inspectNativePageImages(doc:PDFDocument,pageIndex:number,maxPixels=64_000_000):PdfIssue[]{
  const issues:PdfIssue[]=[],seen=new Set<PDFObject>();let nodes=0;const visit=(raw:PDFObject|undefined):void=>{if(!raw)return;const value=raw instanceof PDFRef?doc.context.lookup(raw):raw;if(!value||seen.has(value))return;seen.add(value);if(++nodes>250000)throw Error("IMAGE_RESOURCE_GRAPH_LIMIT");
    if(value instanceof PDFStream){const dict=value.dict;if(name(dict.lookup(PDFName.of("Subtype")))==="Image"){const width=dict.lookup(PDFName.of("Width")),height=dict.lookup(PDFName.of("Height")),w=width instanceof PDFNumber?width.asNumber():NaN,h=height instanceof PDFNumber?height.asNumber():NaN;if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0||w>32768||h>32768||w*h>maxPixels)issues.push({code:"IMAGE_RESOURCE_LIMIT",message:"画像の宣言寸法が処理上限を超えているか不正です。このページの表示を確認できません。",pageIndex,severity:"error"});visit(dict.get(PDFName.of("Mask")));visit(dict.get(PDFName.of("SMask")));}else if(name(dict.lookup(PDFName.of("Subtype")))==="Form")visit(dict.get(PDFName.of("Resources")));return;}
    if(value instanceof PDFDict){visit(value.get(PDFName.of("XObject")));for(const [,child]of value.entries())if(child instanceof PDFRef||child instanceof PDFStream)visit(child);}else if(value instanceof PDFArray)for(let index=0;index<value.size();index++)visit(value.get(index));};
  visit(doc.getPage(pageIndex).node.Resources());return issues;
}

export function extractNativeFields(doc:PDFDocument):{fields:PdfField[];issues:PdfIssue[]} {
  const fields:PdfField[]=[],issues:PdfIssue[]=[];const pages=doc.getPages();const refs=new Map<string,string>();for(const [ref,object] of doc.context.enumerateIndirectObjects())if(object instanceof PDFDict)refs.set(refsKey(object),ref.toString());
  for(const original of doc.getForm().getFields()){
    const internalName=original.getName();const tooltip=stringValue(original.acroField.dict.lookup(PDFName.of("TU")));const label=tooltip||internalName;const classification=classifyLabel(label);let kind:PdfField["kind"]="unknown",initialValue:PdfField["initialValue"]=null,options:PdfField["options"]=[];
    let maxLength:number|null=null,multiSelect=false,editableSelect=false,unsupported=false;
    try {
      if(original instanceof PDFTextField){kind=original.isMultiline()?"multiline":classification.kind;initialValue=original.getText()??"";maxLength=original.getMaxLength()??null;unsupported=original.isPassword()||original.isFileSelector();}
      else if(original instanceof PDFCheckBox){kind="checkbox";initialValue=original.isChecked();}
      else if(original instanceof PDFRadioGroup){kind="radio";initialValue=original.getSelected()??null;options=[...new Set(original.getOptions())].map(value=>({id:value,label:value,exportValue:value,placements:[]}));}
      else if(original instanceof PDFDropdown||original instanceof PDFOptionList){kind="select";multiSelect=original.isMultiselect();editableSelect=original instanceof PDFDropdown&&original.isEditable();const values=original.getSelected();initialValue=multiSelect?values:values[0]??null;options=original.getOptions().map(value=>({id:value,label:value,exportValue:value,placements:[]}));}
      else if(original instanceof PDFSignature){kind="signature";unsupported=true;}
      else unsupported=true;
    }catch{unsupported=true;issues.push({code:"NATIVE_FIELD_UNREADABLE",message:`「${label}」の値は対応していない形式です。`,severity:"warning"});}
    const placements:PdfPlacement[]=[];const widgets=original.acroField.getWidgets();
    for(const [widgetIndex,widget] of widgets.entries()){const rect=widget.getRectangle();let pageIndex=pages.findIndex(p=>widget.P()?.toString()===p.ref.toString());const widgetRef=refs.get(refsKey(widget.dict))??original.ref.toString();
      if(pageIndex<0)pageIndex=pages.findIndex(p=>{const annots=p.node.Annots();return annots?.asArray().some(ref=>ref.toString()===widgetRef);});
      if(pageIndex<0){issues.push({code:"WIDGET_PAGE_UNKNOWN",message:`「${label}」の記入ページを確定できません。`,severity:"error"});continue;}
      const placement:PdfPlacement={pageIndex,quad:rectToQuad([rect.x,rect.y,rect.x+rect.width,rect.y+rect.height]),widgetRef,writingMode:"horizontal"};placements.push(placement);
      if(original instanceof PDFRadioGroup){const values=original.getOptions(),on=values.length===widgets.length?values[widgetIndex]:widget.getOnValue()?.decodeText();const option=options.find(o=>o.exportValue===on);if(option)option.placements.push(placement);}
    }
    // Radio export names are frequently numeric; associate options by widget order when /Opt is present.
    if(kind==="radio"&&options.some(o=>!o.placements.length))options=options.map((o,i)=>({...o,placements:o.placements.length?o.placements:placements[i]?[placements[i]]:[]}));
    const field:PdfField={id:crypto.randomUUID(),revision:1,source:"acroform",kind,label,labelOriginal:label,description:classification.description,role:kind==="signature"?"signature":classification.role,subjectId:null,required:original.isRequired(),requiredEvidenceIds:[`native:${original.ref.toString()}:Ff`],requiredSource:{kind:"native",text:original.isRequired()?"原 PDF の入力欄に必須フラグが指定されています。":"原 PDF の入力欄には必須フラグがありません。文章にある条件も確認してください。",...(placements[0]?{pageIndex:placements[0].pageIndex}:{})},conditionStatus:/場合|のみ|該当.*方|とき/.test(label)?"unknown":"unconditional",condition:null,native:{name:internalName,fieldRef:original.ref.toString(),referenceKind:"field",widgetRefs:placements.map(p=>p.widgetRef!).filter(Boolean),maxLength,lengthUnit:"utf16-code-unit",multiSelect,editableSelect,originalRequired:original.isRequired(),originalReadOnly:original.isReadOnly(),unsupported},placements,options,initialValue,maxGraphemes:null,readOnly:original.isReadOnly()||unsupported||kind==="signature"||classification.role==="office",mappingState:"needs-review",evidenceIds:[],confidence:{text:null,geometry:null,labelMapping:null,calibrationVersion:null}};fields.push(field);
  }return {fields,issues};
}

// Identity is used only inside one parsed context, never persisted as the identity of a PDF object.
const objectIds=new WeakMap<object,string>();let objectCounter=0;
function refsKey(dict:PDFDict):string {let id=objectIds.get(dict);if(!id){id=String(++objectCounter);objectIds.set(dict,id);}return id;}

