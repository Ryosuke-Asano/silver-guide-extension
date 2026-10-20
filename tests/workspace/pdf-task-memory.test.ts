import {readFile} from "node:fs/promises";
import {PDFDocument,PDFHexString,PDFName} from "pdf-lib";
import {describe,expect,it} from "vitest";
import {PdfSession} from "../../src/adapters/pdf";
import {createPdfTask,isPdfTask,updatePdfTask,snapshotPdfMapping} from "../../src/apps/workspace/task-model";

async function nativePdf(visible=true){const doc=await PDFDocument.create(),page=doc.addPage([595,842]),field=doc.getForm().createTextField("applicant_name");field.acroField.dict.set(PDFName.of("TU"),PDFHexString.fromText("氏名"));if(visible)field.addToPage(page,{x:100,y:600,width:300,height:45});field.enableRequired();return doc.save();}
describe("PDF task memory and actual Japanese output",()=>{
  it("keeps answers/history in independent memory and exports real Japanese bytes without changing the source",async()=>{
    const original=await nativePdf(),session=await PdfSession.open(original);
    try{
      const task=createPdfTask(await session.analyze({ocr:"never"})),id=task.fields[0].id,history=snapshotPdfMapping(task);
      const answered=updatePdfTask(task,{answers:{...task.answers,[id]:"山田 花子"},answerStatus:{[id]:"entered"},mappingHistory:[history]});
      const fontBytes=new Uint8Array(await readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf",import.meta.url)));
      const output=await session.export({inputMode:"direct",fields:answered.fields,answers:answered.answers,answerStatus:answered.answerStatus,mode:answered.exportMode,fontBytes,allowIncomplete:true});
      const actual=await PDFDocument.load(output.bytes);expect(output.validated).toBe(true);expect(actual.getForm().getTextField("applicant_name").getText()).toBe("山田 花子");expect(actual.getPageCount()).toBe(1);expect(session.getOriginalBytes()).toEqual(original);
      expect(task.answers[id]).not.toBe("山田 花子");expect(history.answers[id]).not.toBe("山田 花子");expect(answered.answers[id]).toBe("山田 花子");expect(answered.fields[0].required).toBe(true);expect(answered.fields[0].mappingState).toBe(task.fields[0].mappingState);expect(isPdfTask(answered)).toBe(true);
    }finally{await session.dispose();}
  },30000);
  it("retains a native field with no visible widget for explicit position repair",async()=>{const session=await PdfSession.open(await nativePdf(false));try{const task=createPdfTask(await session.analyze({ocr:"never"})),field=task.fields.find(item=>item.native?.name==="applicant_name")!;expect(field.placements).toEqual([]);expect(field.mappingState).toBe("rejected");expect(task.analysis.fields.find(item=>item.id===field.id)!.mappingState).not.toBe("rejected");expect(field.requiredSource).toBeDefined();expect(Object.hasOwn(field.requiredSource!,"pageIndex")).toBe(false);expect(isPdfTask(task)).toBe(true);}finally{await session.dispose();}});
});
