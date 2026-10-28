import { describe, expect, it } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFHexString, PDFName, PDFNumber, degrees } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { PdfSession, makeManualPdfField } from "../../src/adapters/pdf";
import { buildPdfExport, fitText, type BuildExportInput } from "../../src/adapters/pdf/export";
import { extractNativeFields } from "../../src/adapters/pdf/native";
import { rectToQuad, type PdfBox, type PdfField, type PdfPageInfo, type PdfPoint, type PdfQuad } from "../../src/domain/pdf";

type Matrix=[number,number,number,number,number,number];
type Glyph={text:string;origin:PdfPoint;matrix:Matrix;size:number;annotation:PdfBox|null};
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
let fontPromise:Promise<Uint8Array>|undefined;
const fontBytes=()=>fontPromise??=readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf",import.meta.url)).then(value=>new Uint8Array(value));
const pageInfo=(unit=1):PdfPageInfo=>({index:0,label:"1",mediaBox:[0,0,420,595],cropBox:[0,0,420,595],visibleBox:[0,0,420,595],rotation:0,userUnit:unit,widthPt:420*unit,heightPt:595*unit,extraction:"native",review:"inputs-confirmed"});
const input=async(original:Uint8Array,fields:PdfField[],answers:Record<string,string>,unit=1):Promise<BuildExportInput>=>({inputMode:"direct",original,pages:[pageInfo(unit)],fields,answers,mode:"editable-form",fontBytes:await fontBytes(),allowIncomplete:true,actionRemovalConfirmed:false});

// Independent parser reads the saved appearance streams, including their
// annotation-to-page matrix. It does not inspect the writer's reported layout.
async function readGlyphs(bytes:Uint8Array):Promise<Glyph[]>{
  const session=await PdfSession.open(bytes);
  try{
    const lib=await import("pdfjs-dist/legacy/build/pdf.mjs"),pdf=(session as unknown as {pdf:PDFDocumentProxy}).pdf,page=await pdf.getPage(1),ops=await page.getOperatorList({annotationMode:lib.AnnotationMode.ENABLE});
    const glyphs:Glyph[]=[],identity:Matrix=[1,0,0,1,0,0];let ctm:Matrix=[...identity],tm:Matrix=[...identity],size=0,hscale=1,annotation:PdfBox|null=null;
    const stack:Array<{ctm:Matrix;size:number;hscale:number}>=[];
    for(let i=0;i<ops.fnArray.length;i++){
      const op=ops.fnArray[i],args=ops.argsArray[i];
      if(op===lib.OPS.beginAnnotation){annotation=args[1] as PdfBox;ctm=multiply(args[2] as Matrix,args[3] as Matrix);tm=[...identity];}
      else if(op===lib.OPS.endAnnotation){annotation=null;ctm=[...identity];}
      else if(op===lib.OPS.save)stack.push({ctm:[...ctm],size,hscale});
      else if(op===lib.OPS.restore){const state=stack.pop();if(state)({ctm,size,hscale}=state);}
      else if(op===lib.OPS.transform)ctm=multiply(ctm,args as Matrix);
      else if(op===lib.OPS.setTextMatrix)tm=args[0] as Matrix;
      else if(op===lib.OPS.setFont)size=args[1];
      else if(op===lib.OPS.setHScale)hscale=args[0]/100;
      else if(op===lib.OPS.showText){
        const matrix=multiply(ctm,tm);let advance=0;
        for(const run of args[0] as Array<{unicode?:string;width?:number}|number>){
          if(typeof run==="number"){advance-=run/1000*size*hscale;continue;}
          if(run.unicode)glyphs.push({text:run.unicode,origin:{x:matrix[4]+matrix[0]*advance,y:matrix[5]+matrix[1]*advance},matrix:[matrix[0]*hscale,matrix[1]*hscale,matrix[2],matrix[3],0,0],size,annotation});
          advance+=(run.width??0)/1000*size*hscale;
        }
      }
    }
    page.cleanup();return glyphs;
  }finally{await session.dispose();}
}

async function expectInkInside(glyphs:Glyph[],quadFor:(glyph:Glyph)=>PdfQuad){
  const face=fontkit.create(await fontBytes()) as unknown as {unitsPerEm:number;glyphForCodePoint(code:number):{bbox:{minX:number;minY:number;maxX:number;maxY:number}}};
  for(const glyph of glyphs){
    if(!glyph.text.trim())continue;
    const quad=quadFor(glyph),origin=quad[0],width=Math.hypot(quad[1].x-origin.x,quad[1].y-origin.y),height=Math.hypot(quad[3].x-origin.x,quad[3].y-origin.y),ux=(quad[1].x-origin.x)/width,uy=(quad[1].y-origin.y)/width,vx=(quad[3].x-origin.x)/height,vy=(quad[3].y-origin.y)/height;
    const box=face.glyphForCodePoint(glyph.text.codePointAt(0)!).bbox;
    for(const x of[box.minX,box.maxX])for(const y of[box.minY,box.maxY]){
      const px=glyph.origin.x+(glyph.matrix[0]*x+glyph.matrix[2]*y)*glyph.size/face.unitsPerEm,py=glyph.origin.y+(glyph.matrix[1]*x+glyph.matrix[3]*y)*glyph.size/face.unitsPerEm,localX=(px-origin.x)*ux+(py-origin.y)*uy,localY=(px-origin.x)*vx+(py-origin.y)*vy;
      expect(localX,`${glyph.text} horizontal ink`).toBeGreaterThanOrEqual(-.02);expect(localX).toBeLessThanOrEqual(width+.02);expect(localY,`${glyph.text} vertical ink`).toBeGreaterThanOrEqual(-.02);expect(localY).toBeLessThanOrEqual(height+.02);
    }
  }
}

async function evidence(name:string,bytes:Uint8Array){
  const directory=process.env.SG_AUTO_FONT_EVIDENCE_DIR;if(!directory)return;
  const path=resolve(directory);await mkdir(path,{recursive:true});await writeFile(join(path,name),bytes);
}

describe("automatic PDF text size",()=>{
  it("tries the exact minimum at non-integral coordinate steps and preserves CRLF line breaks",()=>{
    const metric={widthOfTextAtSize:(text:string,size:number)=>text.length*size,heightAtSize:(size:number)=>size};
    expect(fitText("A",metric,4/3,4/3,{fontSize:14/3,minSize:4/3,multiline:false,step:.25/3}).size).toBeCloseTo(4/3,10);
    expect(fitText("AB\r\nCD\r\n",metric,30,40,{fontSize:10,minSize:4,multiline:true}).lines).toEqual(["AB","CD",""]);
    expect(()=>fitText("長い",metric,.1,10,{fontSize:14,minSize:4,multiline:true})).toThrow();
  });

  it.each([1,2,3])("fits narrow manual kana and shrink-to-width text at UserUnit%s while leaving roomy type14pt",async unit=>{
    const doc=await PDFDocument.create();doc.addPage([420,595]).node.set(PDFName.of("UserUnit"),PDFNumber.of(unit));const original=await doc.save();
    const values=["サクラギマチコ","カタカナノナガイナマエ","桜木 町子"],boxes:PdfBox[]=[[40,500,129,511],[40,460,104,480],[40,410,300,445]].map(box=>box.map(value=>value/unit) as PdfBox);
    const fields=boxes.map((box,i)=>makeManualPdfField(0,box,`入力${i}`)),answers=Object.fromEntries(fields.map((field,i)=>[field.id,values[i]]));
    const result=await buildPdfExport(await input(original,fields,answers,unit)),glyphs=await readGlyphs(result.bytes);
    expect(glyphs.map(glyph=>glyph.text).join("").replace(/ /g,"")).toBe(values.join("").replace(/ /g,""));
    const narrow=glyphs.filter(glyph=>glyph.origin.y>490/unit),long=glyphs.filter(glyph=>glyph.origin.y>450/unit&&glyph.origin.y<490/unit),roomy=glyphs.filter(glyph=>glyph.origin.y<450/unit);
    expect(narrow.length).toBeGreaterThan(0);expect(narrow.every(glyph=>glyph.size*unit<14&&glyph.size*unit>=4)).toBe(true);expect(long.every(glyph=>glyph.size*unit<10&&glyph.size*unit>=4)).toBe(true);expect(roomy.every(glyph=>Math.abs(glyph.size*unit-14)<.001)).toBe(true);
    await expectInkInside(glyphs,glyph=>fields[glyph.origin.y>490/unit?0:glyph.origin.y>450/unit?1:2].placements[0].quad);
    expect(original).toEqual(await doc.save());if(unit===1)await evidence("automatic-manual-kana.pdf",result.bytes);
    const fixed=structuredClone(fields[1]);fixed.style={fontSizePt:14};await expect(buildPdfExport(await input(original,[fixed],{[fixed.id]:values[1]},unit))).rejects.toMatchObject({code:"TEXT_DOES_NOT_FIT"});
  });

  it("sizes every native widget independently with rotation, borders, Japanese wraps and comb cells",async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([420,595]),form=doc.getForm();
    const repeat=form.createTextField("kana");repeat.addToPage(page,{x:40,y:500,width:89,height:11,borderWidth:0});repeat.addToPage(page,{x:180,y:500,width:120,height:32,borderWidth:1});
    const rotated=form.createTextField("rotated");rotated.addToPage(page,{x:40,y:400,width:75,height:14,borderWidth:.75,rotate:degrees(90)});
    const multiline=form.createTextField("address");multiline.enableMultiline();multiline.addToPage(page,{x:180,y:410,width:70,height:38,borderWidth:1});
    const comb=form.createTextField("postal");comb.setMaxLength(7);comb.enableCombing();comb.addToPage(page,{x:40,y:330,width:43,height:11,borderWidth:0});
    const blank=form.createTextField("tiny-blank");blank.addToPage(page,{x:180,y:330,width:4,height:1,borderWidth:1});
    const original=await doc.save(),fields=extractNativeFields(doc).fields,values:{[key:string]:string}={kana:"サクラギマチコ",rotated:"サクラギ",address:"横浜市西区みほん町一丁目二番三号",postal:"1234567","tiny-blank":""},answers=Object.fromEntries(fields.map(field=>[field.id,values[field.native!.name]]));
    const result=await buildPdfExport(await input(original,fields,answers)),actual=await PDFDocument.load(result.bytes),glyphs=await readGlyphs(result.bytes);
    for(const[name,value]of Object.entries(values))expect(actual.getForm().getTextField(name).getText()??"").toBe(value);
    const repeatSizes=actual.getForm().getTextField("kana").acroField.getWidgets().map(widget=>Number(widget.getDefaultAppearance()?.match(/ ([\d.]+) Tf/)?.[1]));expect(repeatSizes[0]).toBeLessThan(14);expect(repeatSizes[0]).toBeGreaterThanOrEqual(4);expect(repeatSizes[1]).toBe(14);
    expect(glyphs.map(glyph=>glyph.text).join("")).toBe(values.kana.repeat(2)+values.rotated+values.address+values.postal);
    expect(glyphs.every(glyph=>Boolean(glyph.annotation))).toBe(true);await expectInkInside(glyphs,glyph=>rectToQuad(glyph.annotation!));
    const source=await PDFDocument.load(original);for(const field of actual.getForm().getFields()){const widgets=field.acroField.getWidgets(),sourceWidgets=source.getForm().getTextField(field.getName()).acroField.getWidgets();for(let i=0;i<widgets.length;i++){expect(widgets[i].getRectangle()).toEqual(sourceWidgets[i].getRectangle());expect(widgets[i].getAppearanceCharacteristics()?.getRotation()).toBe(sourceWidgets[i].getAppearanceCharacteristics()?.getRotation());}}
    await evidence("automatic-native-kana.pdf",result.bytes);
  });

  it("fits short manual cells and rotated vertical kana ink at physical sizes with UserUnit3",async()=>{
    const unit=3,doc=await PDFDocument.create();doc.addPage([420,595]).node.set(PDFName.of("UserUnit"),PDFNumber.of(unit));
    const cells=makeManualPdfField(0,[40/unit,500/unit,72/unit,507/unit],"番号"),vertical=makeManualPdfField(0,[200/unit,400/unit,208/unit,436/unit],"縦書きフリガナ");
    cells.placements[0].cells=Array.from({length:4},(_,index)=>rectToQuad([(40+index*8)/unit,500/unit,(48+index*8)/unit,507/unit]));vertical.placements[0].writingMode="vertical";
    const result=await buildPdfExport(await input(await doc.save(),[cells,vertical],{[cells.id]:"1234",[vertical.id]:"サーギ"},unit)),glyphs=await readGlyphs(result.bytes);
    expect(glyphs.map(glyph=>glyph.text).join("")).toBe("1234サーギ");expect(glyphs.every(glyph=>glyph.size*unit>=4&&glyph.size*unit<10)).toBe(true);
    await expectInkInside(glyphs,glyph=>glyph.origin.x>150/unit?vertical.placements[0].quad:cells.placements[0].cells![Math.max(0,Math.min(3,Math.floor((glyph.origin.x-40/unit)/(8/unit))))]);
  });

  it("writes the actual library11pt furigana fields and validates a reopened saved PDF",async()=>{
    const bytes=new Uint8Array(await readFile(new URL("../../demo/assets/library-application-fillable.pdf",import.meta.url))),session=await PdfSession.open(bytes);
    try{
      const analysis=await session.analyze({ocr:"never"}),fields=analysis.fields.filter(field=>field.native),values:{[key:string]:string}={family_name_kana:"サクラギ",given_name_kana:"マチコ",family_name:"桜木",given_name:"町子",postal_code_prefix:"220",postal_code_suffix:"0032",address:"西区みほん町1-2-3",home_phone_local:"000",home_phone_number:"0000"},answers=Object.fromEntries(fields.map(field=>[field.id,values[field.native!.name]??""]));
      const result=await session.export({fields,answers,fontBytes:await fontBytes(),inputMode:"direct",allowIncomplete:true});expect(result.validated).toBe(true);const reopened=await session.openValidatedOutput(result);await reopened.dispose();
      const actual=await PDFDocument.load(result.bytes);for(const[name,value]of Object.entries(values))expect(actual.getForm().getTextField(name).getText()).toBe(value);
      for(const name of["family_name_kana","given_name_kana"]){const widget=actual.getForm().getTextField(name).acroField.getWidgets()[0],size=Number(widget.getDefaultAppearance()?.match(/ ([\d.]+) Tf/)?.[1]);expect(size).toBeGreaterThanOrEqual(4);expect(size).toBeLessThan(14);expect(widget.getNormalAppearance()).toBeDefined();}
      expect(session.getOriginalBytes()).toEqual(bytes);await evidence("automatic-library-filled.pdf",result.bytes);
    }finally{await session.dispose();}
  },30000);
});
