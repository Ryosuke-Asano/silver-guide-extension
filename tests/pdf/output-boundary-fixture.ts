import {PDFDocument, PDFName} from "pdf-lib";
import {PDF_MAX_INPUT_BYTES} from "../../src/domain/pdf";

/** Retained, non-rendered, uncompressed bytes exercise writer growth at the input boundary. */
export async function makeInputBoundaryFixture():Promise<Uint8Array>{
  const document=await PDFDocument.create(),page=document.addPage([595,842]);
  page.drawText("Synthetic boundary fixture - no personal information",{x:40,y:780,size:12});
  const padding=document.context.register(document.context.stream(new Uint8Array()));
  document.catalog.set(PDFName.of("SyntheticPadding"),padding);
  let length=PDF_MAX_INPUT_BYTES-4096;
  for(let attempt=0;attempt<3;attempt++){
    document.context.assign(padding,document.context.stream(new Uint8Array(length)));
    const bytes=await document.save({useObjectStreams:false,updateFieldAppearances:false});
    if(bytes.byteLength===PDF_MAX_INPUT_BYTES)return bytes;
    length+=PDF_MAX_INPUT_BYTES-bytes.byteLength;
  }
  throw Error("Could not construct the exact input-size boundary fixture");
}
