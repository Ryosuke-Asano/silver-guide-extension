import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PDFDocument, PDFHexString, PDFName, PDFNumber, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PdfSession } from "../../src/adapters/pdf";
import { inferFields } from "../../src/adapters/pdf/structure";
import { embedJapaneseFont } from "../../src/adapters/pdf/export";
import { type PdfBox, type PdfPoint, type PdfQuad } from "../../src/domain/pdf";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

type Angle = 0 | 90 | 180 | 270;
type SourceRow = { label: string; kind: "number" | "date"; answer: string; cells: PdfQuad[]; labelAt: PdfPoint };
type Matrix = [number, number, number, number, number, number];
type Glyph = { text: string; origin: PdfPoint; a: number; b: number; c: number; d: number; fontSize: number; advance: number };
const USER_UNIT = 2;
const CROP = [20, 30, 280, 390] as const;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const box = (quad: PdfQuad): PdfBox => [Math.min(...quad.map(p => p.x)), Math.min(...quad.map(p => p.y)), Math.max(...quad.map(p => p.x)), Math.max(...quad.map(p => p.y))];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const sourceAxes = (angle: Angle) => angle === 90 ? { along: {x:0,y:1}, across:{x:-1,y:0} } : angle === 180 ? { along:{x:-1,y:0}, across:{x:0,y:-1} } : angle === 270 ? { along:{x:0,y:-1}, across:{x:1,y:0} } : { along:{x:1,y:0}, across:{x:0,y:1} };

// The oracle is declared by the source producer, independently of the detector
// or writer's matrix helpers. All source coordinates stay positive/in-page.
function sourceRows(angle: Angle): SourceRow[] {
  const axes = sourceAxes(angle);
  const starts = angle === 90 ? [{x:220,y:60},{x:150,y:60}] : angle === 180 ? [{x:240,y:280},{x:240,y:200}] : angle === 270 ? [{x:60,y:300},{x:150,y:300}] : [{x:60,y:270},{x:60,y:190}];
  return ["123456", "20261013"].map((answer, row) => {
    const start = starts[row];
    const cells = [...answer].map((_, cell) => {
      const point = (x: number, y: number): PdfPoint => ({x:start.x+axes.along.x*(cell*8+x)+axes.across.x*y,y:start.y+axes.along.y*(cell*8+x)+axes.across.y*y});
      return [point(0,0),point(8,0),point(8,14),point(0,14)] as PdfQuad;
    });
    return { label: row ? "生年月日" : "金額", kind: row ? "date" : "number", answer, cells, labelAt:{x:cells[0][3].x+axes.across.x*4,y:cells[0][3].y+axes.across.y*4} };
  });
}

let fontPromise: Promise<Uint8Array> | undefined;
const fontBytes = () => fontPromise ??= readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf", import.meta.url)).then(bytes => new Uint8Array(bytes));
async function fixture(angle: Angle) {
  const doc = await PDFDocument.create();doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const page = doc.addPage([300,420]);page.setCropBox(CROP[0],CROP[1],CROP[2]-CROP[0],CROP[3]-CROP[1]);page.setRotation(degrees(angle));page.node.set(PDFName.of("UserUnit"),PDFNumber.of(USER_UNIT));
  const rows = sourceRows(angle),font = await embedJapaneseFont(doc,await fontBytes());
  for(const row of rows){page.drawText(row.label,{...row.labelAt,font,size:6,rotate:degrees(angle)});for(const cell of row.cells){const b=box(cell);page.drawRectangle({x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1],borderWidth:.25});}}
  const sentinel = doc.getForm().createTextField("source.readonly");sentinel.acroField.dict.set(PDFName.of("TU"),PDFHexString.fromText("Office only"));sentinel.addToPage(page,{x:35,y:45,width:80,height:16});sentinel.setText("KEEP");sentinel.enableReadOnly();
  const bytes = await doc.save();return {bytes,rows,hash:digest(bytes)};
}

// Reads actual output operators, not BuildExportResult.written. Each cell's
// drawText must supply one Unicode digit and its real font/matrix. No browser,
// OCR, fake render result or renderer-provided placement oracle is used here.
async function digitOperators(pdf: PDFDocumentProxy, singleDigitRunsOnly = true): Promise<Glyph[]> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs"),page=await pdf.getPage(1),operators=await page.getOperatorList({annotationMode:lib.AnnotationMode.DISABLE});
  const glyphs: Glyph[]=[];let ctm: Matrix=[1,0,0,1,0,0],textMatrix: Matrix=[1,0,0,1,0,0],size=0,hscale=1;const stack:Array<{ctm:Matrix;size:number;hscale:number}>=[];
  for(let i=0;i<operators.fnArray.length;i++){
    const op=operators.fnArray[i],args=operators.argsArray[i];
    if(op===lib.OPS.save)stack.push({ctm:[...ctm],size,hscale});
    else if(op===lib.OPS.restore){const saved=stack.pop();if(saved)({ctm,size,hscale}=saved);}
    else if(op===lib.OPS.transform)ctm=multiply(ctm,args as Matrix);
    else if(op===lib.OPS.setTextMatrix)textMatrix=args[0] as Matrix;
    else if(op===lib.OPS.setFont)size=args[1];
    else if(op===lib.OPS.setHScale)hscale=args[0]/100;
    else if(op===lib.OPS.showText){
      const runs=args[0] as Array<{unicode?:string;width?:number}|number>,digits=runs.filter((g):g is {unicode:string;width:number}=>typeof g!=="number"&&typeof g.unicode==="string"&&/^\d$/.test(g.unicode));
      if(!digits.length)continue;
      if(singleDigitRunsOnly){expect(runs).toHaveLength(1);expect(digits).toHaveLength(1);}
      const m=multiply(ctm,textMatrix);let advance=0;
      for(const run of runs){if(typeof run==="number"){advance-=run/1000*size*hscale;continue;}const width=(run.width??0)/1000*size*hscale;if(run.unicode&&/^\d$/.test(run.unicode))glyphs.push({text:run.unicode,origin:{x:m[4]+m[0]*advance,y:m[5]+m[1]*advance},a:m[0]*hscale,b:m[1]*hscale,c:m[2],d:m[3],fontSize:size,advance:width});advance+=width;}
    }
  }
  page.cleanup();return glyphs;
}

function project(cell: PdfQuad, point: PdfPoint) {
  const q=cell[0],ux=(cell[1].x-q.x)/8,uy=(cell[1].y-q.y)/8,vx=(cell[3].x-q.x)/14,vy=(cell[3].y-q.y)/14;
  return {x:(point.x-q.x)*ux+(point.y-q.y)*uy,y:(point.x-q.x)*vx+(point.y-q.y)*vy};
}

describe("source-first UserUnit and ordered-cell writer geometry",()=>{
  it("keeps an upside-down raw right-side label and writes along the negative-x source quad after explicit180 correction",async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([650,780]),labelFont=await embedJapaneseFont(doc,await fontBytes());page.setRotation(degrees(180));page.setCropBox(260,640,340,100);page.drawRectangle({x:300,y:680,width:200,height:20,borderWidth:.25});page.drawText("氏名",{x:560,y:696,size:12,font:labelFont,rotate:degrees(180)});
    const bytes=await doc.save(),original=bytes.slice(),sourceHash=digest(bytes),session=await PdfSession.open(bytes);let preview:PdfSession|null=null;
    try{const analysis=await session.analyze({ocr:"never"}),fields=inferFields(0,[[300,680,500,700]],analysis.evidence,[],1,180);expect(fields).toHaveLength(1);const field=fields[0];expect(field.label).toBe("氏名");expect(field.placements[0].quad[1].x-field.placements[0].quad[0].x).toBe(-200);expect(field.placements[0].quad[1].y-field.placements[0].quad[0].y).toBe(0);field.role="applicant";field.mappingState="confirmed";field.required=false;field.requiredSource={kind:"manual",text:"架空の幾何試験欄を原本の作成仕様で任意と確認",pageIndex:0};const before=structuredClone(session.info.pages),output=await session.export({fields,answers:{[field.id]:"123456"},answerStatus:{[field.id]:"entered"},pageReviews:[{pageIndex:0,review:"inputs-confirmed"}],fontBytes:await fontBytes()});expect(output.validated).toBe(true);expect(output.originalHash).toBe(sourceHash);expect(bytes).toEqual(original);expect(session.info.pages).toEqual(before);
      preview=await session.openValidatedOutput(output);const glyphs=await digitOperators((preview as unknown as {pdf:PDFDocumentProxy}).pdf,false);expect(glyphs.map(g=>g.text).join("")).toBe("123456");for(const [index,glyph]of glyphs.entries()){expect(glyph.a).toBeCloseTo(-1,8);expect(glyph.b).toBeCloseTo(0,8);expect(glyph.c).toBeCloseTo(0,8);expect(glyph.d).toBeCloseTo(-1,8);expect(glyph.fontSize).toBe(14);expect(glyph.origin.x).toBeGreaterThan(300);expect(glyph.origin.x+glyph.a*glyph.advance).toBeGreaterThan(300);expect(glyph.origin.x).toBeLessThan(500);expect(glyph.origin.y).toBeGreaterThan(680);expect(glyph.origin.y).toBeLessThan(700);if(index)expect(glyph.origin.x).toBeLessThan(glyphs[index-1].origin.x);}
    }finally{await preview?.dispose();await session.dispose();}
  },30000);
  for(const angle of [0,90,180,270] as const)it(`writes number6/date8 into source-ordered cells, UserUnit2/CropBox/rotation${angle}, preserving native source`,async()=>{
    const source=await fixture(angle),original=source.bytes.slice(),session=await PdfSession.open(source.bytes,{name:`geometry-${angle}.pdf`});let preview:PdfSession|null=null;
    try{
      const analysis=await session.analyze({ocr:"never"}),native=analysis.fields.filter(field=>field.native),sourceNative=structuredClone(native);
      const fields=inferFields(0,source.rows.flatMap(row=>row.cells.map(box)),analysis.evidence,native,USER_UNIT,angle);
      expect(fields).toHaveLength(2);
      for(const row of source.rows){const field=fields.find(field=>field.label===row.label)!;expect(field).toBeDefined();expect(field.kind).toBe(row.kind);expect(field.placements[0].cells).toHaveLength(row.answer.length);expect(field.maxGraphemes).toBe(row.answer.length);
        for(let cell=0;cell<row.cells.length;cell++)for(let point=0;point<4;point++){expect(field.placements[0].cells![cell][point].x).toBeCloseTo(row.cells[cell][point].x,8);expect(field.placements[0].cells![cell][point].y).toBeCloseTo(row.cells[cell][point].y,8);}
        field.role="applicant";field.mappingState="confirmed";field.required=false;field.requiredSource={kind:"manual",text:"架空の幾何試験欄を原本の作成仕様で任意と確認",pageIndex:0};field.conditionStatus="unconditional";
      }
      expect(native).toEqual(sourceNative);const beforePages=structuredClone(session.info.pages),allFields=[...native,...fields],answers=Object.fromEntries(fields.map(field=>[field.id,source.rows.find(row=>row.label===field.label)!.answer]));answers[native[0].id]="KEEP";
      const output=await session.export({fields:allFields,answers,answerStatus:Object.fromEntries(allFields.map(field=>[field.id,"entered"])),pageReviews:[{pageIndex:0,review:"inputs-confirmed"}],fontBytes:await fontBytes(),mode:"overlay"});
      expect(output.validated).toBe(true);expect(output.originalHash).toBe(source.hash);expect(digest(source.bytes)).toBe(source.hash);expect(source.bytes).toEqual(original);expect(session.info.pages).toEqual(beforePages);
      preview=await session.openValidatedOutput(output);expect(preview.info.hash).toBe(output.hash);expect(preview.info.pageCount).toBe(1);expect(preview.info.pages.map(({review,extraction,...page})=>page)).toEqual(beforePages.map(({review,extraction,...page})=>page));
      const saved=await PDFDocument.load(output.bytes),savedPage=saved.getPage(0);expect(savedPage.getRotation().angle).toBe(angle);expect(savedPage.node.lookup(PDFName.of("UserUnit"),PDFNumber).asNumber()).toBe(USER_UNIT);expect(savedPage.getCropBox()).toEqual({x:20,y:30,width:260,height:360});expect(savedPage.getMediaBox()).toEqual({x:0,y:0,width:300,height:420});
      const protectedField=saved.getForm().getTextField("source.readonly"),sourceDoc=await PDFDocument.load(original);expect(protectedField.getText()).toBe("KEEP");expect(protectedField.isReadOnly()).toBe(true);expect(protectedField.acroField.getWidgets()[0].getRectangle()).toEqual(sourceDoc.getForm().getTextField("source.readonly").acroField.getWidgets()[0].getRectangle());
      const glyphs=await digitOperators((preview as unknown as {pdf:PDFDocumentProxy}).pdf);expect(glyphs).toHaveLength(14);
      const face=fontkit.create(await fontBytes()) as unknown as {unitsPerEm:number;glyphForCodePoint(code:number):{bbox:{minX:number;minY:number;maxX:number;maxY:number}}};
      const axes=sourceAxes(angle),used=new Set<Glyph>();
      for(const row of source.rows)for(let index=0;index<row.cells.length;index++){
        const cell=row.cells[index],inside=glyphs.filter(glyph=>{const p=project(cell,glyph.origin);return p.x>=0&&p.x<8&&p.y>=0&&p.y<14;});expect(inside,JSON.stringify({angle,label:row.label,index,cell,glyphs})).toHaveLength(1);const glyph=inside[0];expect(used.has(glyph)).toBe(false);used.add(glyph);expect(glyph.text).toBe(row.answer[index]);
        expect(glyph.a).toBeCloseTo(axes.along.x,8);expect(glyph.b).toBeCloseTo(axes.along.y,8);expect(glyph.c).toBeCloseTo(axes.across.x,8);expect(glyph.d).toBeCloseTo(axes.across.y,8);expect(glyph.fontSize*USER_UNIT).toBeCloseTo(14,6);
        const metrics=face.glyphForCodePoint(glyph.text.codePointAt(0)!).bbox;expect((metrics.maxX-metrics.minX)/face.unitsPerEm*glyph.fontSize*USER_UNIT).toBeGreaterThan(1);expect((metrics.maxY-metrics.minY)/face.unitsPerEm*glyph.fontSize*USER_UNIT).toBeGreaterThan(5);
        for(const x of[metrics.minX,metrics.maxX])for(const y of[metrics.minY,metrics.maxY]){const point={x:glyph.origin.x+(glyph.a*x+glyph.c*y)/face.unitsPerEm*glyph.fontSize,y:glyph.origin.y+(glyph.b*x+glyph.d*y)/face.unitsPerEm*glyph.fontSize},local=project(cell,point);expect(local.x).toBeGreaterThanOrEqual(-.05);expect(local.x).toBeLessThanOrEqual(8.05);expect(local.y).toBeGreaterThanOrEqual(-.05);expect(local.y).toBeLessThanOrEqual(14.05);}
      }
      expect(used.size).toBe(14);expect(native).toEqual(sourceNative);
      if(process.env.SG_GEOMETRY_EVIDENCE_DIR){
        const directory=resolve(process.env.SG_GEOMETRY_EVIDENCE_DIR),allowed=resolve("E:/others/silverguide-qa");if(!directory.toLowerCase().startsWith(allowed.toLowerCase()+"\\"))throw Error("Geometry evidence must remain in the task QA directory");
        await mkdir(directory,{recursive:true});await writeFile(join(directory,`source-${angle}.pdf`),source.bytes);await writeFile(join(directory,`filled-node-${angle}.pdf`),output.bytes);
        await writeFile(join(directory,`oracle-${angle}.json`),JSON.stringify({angle,userUnit:USER_UNIT,sourceHash:source.hash,nodeOutputHash:output.hash,rows:source.rows,fields:allFields,answers,answerStatus:Object.fromEntries(allFields.map(field=>[field.id,"entered"])),pageReviews:[{pageIndex:0,review:"inputs-confirmed"}],glyphs,nodeValidated:true,scope:"Current-source explicit analysis basis to actual Node writer/parser; not a compiled browser/OCR selection claim"},null,2));
      }
    }finally{await preview?.dispose();await session.dispose();}
  },30000);
});
