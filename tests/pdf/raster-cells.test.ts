import {describe,expect,it} from "vitest";
import {PDFDocument} from "pdf-lib";
import {detectRasterBoxes,inferFields} from "../../src/adapters/pdf/structure";
import {PdfSession,rectToQuad,type PdfBox,type PdfEvidence} from "../../src/adapters/pdf";

const scale=4;
function raster(){
  const width=1000,height=640,data=new Uint8ClampedArray(width*height*4).fill(255);
  const line=(x0:number,y0:number,x1:number,y1:number)=>{for(let y=Math.round(y0*scale);y<=Math.round(y1*scale);y++)for(let x=Math.round(x0*scale);x<=Math.round(x1*scale);x++){const index=(y*width+x)*4;data[index]=data[index+1]=data[index+2]=0;}};
  const rect=(box:PdfBox)=>{const[x0,y0,x1,y1]=box;line(x0,y0,x1,y0);line(x0,y1,x1,y1);line(x0,y0,x0,y1);line(x1,y0,x1,y1);};
  const boxes=()=>detectRasterBoxes(data,width,height).map(box=>box.map(value=>value/scale)as PdfBox);
  return{line,rect,boxes};
}
function ocr(text:string,box:PdfBox,confidence=34):PdfEvidence{return{id:text,pageIndex:0,text,quad:rectToQuad(box),method:"ocr",rawOcrConfidence:confidence};}

describe("raster elementary cells and printed closed glyphs",()=>{
  it("rejects the outer three-hole glyph while preserving a same-sized real empty checkbox",()=>{
    const image=raster();image.rect([20,20,29,30.5]);image.line(20,23.5,29,23.5);image.line(20,27,29,27);
    image.rect([50,20,59,30.5]);const boxes=image.boxes();expect(boxes.filter(box=>box[0]<30)).toHaveLength(3);expect(boxes.some(box=>box[0]===20&&box[3]-box[1]>4)).toBe(false);
    const fields=inferFields(0,boxes,[ocr("署名は ご自身で",[10,18,85,33])]);expect(fields).toHaveLength(1);expect(fields[0].kind).toBe("checkbox");expect(fields[0].placements[0].quad).toEqual(rectToQuad([50,20,59,30.5]));
  });
  it("keeps a genuine 8pt checkbox even when a low-confidence OCR line spans its empty interior and label",()=>{
    const image=raster();image.rect([20,20,28,28]);for(const confidence of [0,34]){const fields=inferFields(0,image.boxes(),[ocr("口 同意する",[18,18,85,30],confidence)]);expect(fields).toHaveLength(1);expect(fields[0].kind).toBe("checkbox");}
  });
  it("groups all seven small digit cells without generating rectangles over multiple rows",()=>{
    const image=raster();for(let column=0;column<7;column++)image.rect([20+column*12,20,32+column*12,32]);
    const fields=inferFields(0,image.boxes(),[ocr("番号",[2,21,15,29],90)]);expect(fields).toHaveLength(1);expect(fields[0].kind).toBe("text");expect(fields[0].placements[0].cells).toHaveLength(7);expect(fields[0].maxGraphemes).toBe(7);
  });
  it("keeps tall merged cells beside partially divided rows and preserves multiline answer boxes",()=>{
    const image=raster();image.rect([20,20,200,70]);image.line(90,20,90,70);image.line(90,45,200,45);image.rect([20,100,200,145]);
    const boxes=image.boxes();expect(boxes).toHaveLength(4);expect(boxes).toEqual(expect.arrayContaining([[20,20,90,70],[90,20,200,45],[90,45,200,70],[20,100,200,145]]));
  });
  it("does not treat a low-confidence line over a long empty box as certain printed occupancy",()=>{
    const image=raster();image.rect([20,20,200,55]);const fields=inferFields(0,image.boxes(),[ocr("不確かな認識結果",[18,18,202,57])]);expect(fields).toHaveLength(1);expect(fields[0].kind).toBe("text");
  });
  it("retains native checkbox authority when its tiny widget shares the geometry of a text-like raster shape",async()=>{
    const document=await PDFDocument.create(),page=document.addPage([595,842]);document.getForm().createCheckBox("small.native").addToPage(page,{x:50,y:700,width:8,height:10,borderWidth:0});const session=await PdfSession.open(await document.save());
    try{const analysis=await session.analyze({ocr:"never"}),field=analysis.fields.find(item=>item.native?.name==="small.native")!;expect(field.source).toBe("acroform");expect(field.kind).toBe("checkbox");const image=raster();image.rect([50,20,58,30]);image.line(50,23,58,23);image.line(50,27,58,27);const before=structuredClone(field),boxes=image.boxes().map(([x0,y0,x1,y1])=>[x0,730-y1,x1,730-y0]as PdfBox);inferFields(0,boxes,[ocr("認識が不確か",[45,698,80,712])],[field]);expect(field).toEqual(before);expect(analysis.fields).toContain(field);}
    finally{await session.dispose();}
  });
});
