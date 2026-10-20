import {describe,expect,it,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {PdfSession,PDF_MAX_INPUT_BYTES,PDF_MAX_OUTPUT_BYTES,makeManualPdfField} from "../../src/adapters/pdf";
import {encryptedFixture} from "../workspace/pdf-controller/encrypted-fixture";

const font=()=>readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf",import.meta.url)).then(bytes=>new Uint8Array(bytes));
async function fixture(){const document=await PDFDocument.create();document.addPage([595,842]);return document.save();}
async function exportBlank(session:PdfSession){return session.export({fields:[],answers:{},fontBytes:await font()});}

describe("validated output provenance and bounded reopening",()=>{
  it("exposes no runtime method/options for raising the external input limit",async()=>{
    expect(PDF_MAX_INPUT_BYTES).toBe(104857600);expect(PDF_MAX_OUTPUT_BYTES).toBe(167772160);
    expect(Object.getOwnPropertyNames(PdfSession)).not.toContain("openCore");
    await expect(PdfSession.open(new Uint8Array(PDF_MAX_INPUT_BYTES+1))).rejects.toMatchObject({code:"BYTE_LIMIT"});
  });
  it("reopens this session's validated result but refuses copies and results from a different original",async()=>{
    const session=await PdfSession.open(await fixture()),other=await PdfSession.open(await fixture());let preview:PdfSession|null=null;
    try{const result=await exportBlank(session);preview=await session.openValidatedOutput(result);expect(preview.info.hash).toBe(result.hash);expect(preview.info.pageCount).toBe(result.pageCount);await expect(session.openValidatedOutput({...result})).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});await expect(other.openValidatedOutput(result)).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});}
    finally{await preview?.dispose();await other.dispose();await session.dispose();}
  },20000);
  it("refuses registered bytes changed at equal length even if callers recompute a claimed hash",async()=>{
    const session=await PdfSession.open(await fixture());try{const result=await exportBlank(session),original=result.bytes[0];result.bytes[0]^=1;await expect(session.openValidatedOutput(result)).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});result.hash=await import("../../src/adapters/pdf/geometry").then(module=>module.sha256(result.bytes));await expect(session.openValidatedOutput(result)).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});result.bytes[0]=original;}
    finally{await session.dispose();}
  },20000);
  it("rejects altered validation/provenance metadata and cannot open after disposal or cancellation",async()=>{
    const session=await PdfSession.open(await fixture());try{const result=await exportBlank(session),hash=result.originalHash;result.originalHash="a".repeat(64);await expect(session.openValidatedOutput(result)).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});result.originalHash=hash;result.validated=false;await expect(session.openValidatedOutput(result)).rejects.toMatchObject({code:"OUTPUT_PROVENANCE_MISMATCH"});result.validated=true;const abort=new AbortController();abort.abort();await expect(session.openValidatedOutput(result,{signal:abort.signal})).rejects.toMatchObject({name:"AbortError"});await session.dispose();await expect(session.openValidatedOutput(result)).rejects.toMatchObject({code:"SESSION_CLOSED"});}
    finally{await session.dispose();}
  },20000);
  it("refuses writer output exceeding the generated output limit before parsing it or marking it validated",async()=>{
    const session=await PdfSession.open(await fixture()),fontBytes=await font();const save=vi.spyOn(PDFDocument.prototype,"save").mockResolvedValueOnce(new Uint8Array(PDF_MAX_OUTPUT_BYTES+1));
    try{await expect(session.export({fields:[],answers:{},fontBytes})).rejects.toMatchObject({code:"OUTPUT_BYTE_LIMIT"});}
    finally{save.mockRestore();await session.dispose();}
  },20000);
  it("preserves read-only native metadata without describing encrypted widgets as user-added fields",async()=>{
    const session=await PdfSession.open(encryptedFixture,{password:"synthetic-pdf-password"});try{const analysis=await session.analyze({ocr:"never"}),field=analysis.fields.find(item=>item.native)!;expect(field.source).toBe("acroform");expect(field.native!.referenceKind).toBe("read-only-widget");expect(field.description).not.toBe(makeManualPdfField(0,[10,10,50,50]).description);expect(field.required).toBe(false);expect(field.requiredSource?.text).toContain("必須フラグがありません");expect(field.requiredSource?.kind).toBe("native");expect(field.requiredEvidenceIds).toEqual([`native:${field.native!.fieldRef}:Ff`]);expect(field.readOnly).toBe(true);expect(session.info.capabilities.export.allowed).toBe(false);}
    finally{await session.dispose();}
  },20000);
});
