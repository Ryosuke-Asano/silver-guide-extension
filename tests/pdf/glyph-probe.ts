import type {PDFDocumentProxy} from "pdfjs-dist/types/src/display/api";
import {PdfSession,quadToBox,rectToQuad,type PdfAffine} from "../../src/adapters/pdf";
import {detectRasterBoxes} from "../../src/adapters/pdf/structure";
import {context2d,createCanvas,deskew} from "../../src/adapters/pdf/raster";
import {inverse,transformQuad} from "../../src/adapters/pdf/geometry";

(window as unknown as {glyphProbe:()=>Promise<unknown>}).glyphProbe=async()=>{
  const bytes=new Uint8Array(await(await fetch("/qa-fixture.pdf")).arrayBuffer()),session=await PdfSession.open(bytes,{name:"scan-10-300dpi.pdf"});
  try{
    const pdf=(session as unknown as {pdf:PDFDocumentProxy}).pdf,page=await pdf.getPage(1),viewport=page.getViewport({scale:300/72}),canvas=createCanvas(Math.min(3200,viewport.width),Math.min(3200,viewport.height));
    const task=page.render({canvas:canvas as HTMLCanvasElement,canvasContext:context2d(canvas) as CanvasRenderingContext2D,viewport,transform:[1,0,0,1,0,0],annotationMode:1,background:"white"});await task.promise;page.cleanup();
    const corrected=deskew(canvas,inverse(viewport.transform as PdfAffine)),raw=detectRasterBoxes(context2d(corrected.canvas).getImageData(0,0,corrected.canvas.width,corrected.canvas.height).data,corrected.canvas.width,corrected.canvas.height),rawBoxes=raw.map(box=>({pixels:box,quad:transformQuad(corrected.imageToPdf,rectToQuad(box)),pdf:quadToBox(transformQuad(corrected.imageToPdf,rectToQuad(box)))}));
    const analysis=await session.analyze({pageIndices:[0]});await session.render(0,document.querySelector<HTMLCanvasElement>("#original")!,{scale:2});
    const result={fixtureHash:session.info.hash,fixtureBytes:bytes.byteLength,documentPageCount:session.info.pageCount,analyzedPages:[0],analysis,rawTile:{width:corrected.canvas.width,height:corrected.canvas.height,imageToPdf:corrected.imageToPdf,rawBoxes}};
    canvas.width=1;canvas.height=1;if(corrected.canvas!==canvas){corrected.canvas.width=1;corrected.canvas.height=1;}return result;
  }finally{await session.dispose();}
};
