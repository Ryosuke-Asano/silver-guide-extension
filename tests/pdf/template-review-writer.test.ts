import {describe,expect,it} from "vitest";
import {readFile} from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {PdfSession,validatePdfFields,type PdfField,type PdfTemplateBinding} from "../../src/adapters/pdf";

const font=()=>readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf",import.meta.url)).then(bytes=>new Uint8Array(bytes));
async function fixture(){const doc=await PDFDocument.create(),page=doc.addPage([595,842]);for(const[name,index]of [["acknowledged",0],["excluded",1],["locked",2],["normal",3]]as const){const field=doc.getForm().createTextField(name);field.addToPage(page,{x:70,y:700-index*100,width:320,height:45});if(name==="excluded")field.setText("Excluded original");if(name==="locked"){field.setText("Read-only original");field.enableReadOnly();}}return doc.save();}
/** Synthetic provenance tests the explicit review contract, not signed-catalog authority. */
function staleBinding(hash:string):PdfTemplateBinding{return{schemaVersion:1,templateId:"synthetic-template",templateVersion:"1.0.0",templateFieldId:"name",match:"exact",originalHash:hash,layoutFingerprint:null,descriptorHash:"a".repeat(64),fieldSemanticHash:"b".repeat(64),adoptedAt:"2026-10-12T00:00:00Z",source:{keyId:"synthetic-key",packageId:"synthetic-package",release:1,payloadHash:"c".repeat(64),sourceURL:"https://example.test/blank.pdf",reviewedAt:"2026-10-12T00:00:00Z",validUntil:"2026-10-13T00:00:00Z",packageValidUntil:"2026-10-13T00:00:00Z"},review:{state:"needs-review",reason:"revoked",invalidationKey:"synthetic-revoked-origin"}};}

describe("explicit stale-template review at the native writer boundary",()=>{
  it.each(["confirmed","manual"]as const)("rejects %s mapping flags and allowIncomplete without changing the actual original",async mappingState=>{
    const bytes=await fixture(),session=await PdfSession.open(bytes);try{const analysis=await session.analyze({ocr:"never"}),field:PdfField={...analysis.fields.find(item=>item.native?.name==="acknowledged")!,role:"applicant",mappingState,templateBinding:staleBinding(session.info.hash)},answers={[field.id]:"原本確認前の架空回答"};
      for(const value of [answers,{[field.id]:""}]){expect(validatePdfFields([field],value,analysis.document.pages,{allowIncomplete:true})).toEqual([expect.objectContaining({code:"TEMPLATE_REVIEW_REQUIRED",fieldId:field.id})]);await expect(session.export({fields:[field],answers:value,allowIncomplete:true,fontBytes:await font()})).rejects.toMatchObject({code:"ANSWERS_INVALID",issues:expect.arrayContaining([expect.objectContaining({code:"TEMPLATE_REVIEW_REQUIRED",fieldId:field.id})])});}
      expect(session.getOriginalBytes()).toEqual(bytes);expect(field.templateBinding?.review.state).toBe("needs-review");const original=await PDFDocument.load(bytes);expect(original.getForm().getTextField("acknowledged").getText()??"").toBe("");
    }finally{await session.dispose();}
  });
  it("writes manual-confirmed and ordinary native values while retaining excluded and source-readonly originals",async()=>{
    const bytes=await fixture(),session=await PdfSession.open(bytes);try{const fields:PdfField[]=(await session.analyze({ocr:"never"})).fields.filter(field=>field.native).map(field=>({...field,role:"applicant" as const,mappingState:"confirmed" as const})),acknowledged=fields.find(field=>field.native?.name==="acknowledged")!,excluded=fields.find(field=>field.native?.name==="excluded")!,locked=fields.find(field=>field.native?.name==="locked")!,normal=fields.find(field=>field.native?.name==="normal")!;
      acknowledged.templateBinding={...staleBinding(session.info.hash),review:{state:"manual-confirmed",reason:"revoked",invalidationKey:"synthetic-revoked-origin",confirmedAt:"2026-10-13T01:00:00Z"}};excluded.templateBinding=staleBinding(session.info.hash);excluded.mappingState="rejected";locked.templateBinding=staleBinding(session.info.hash);
      const answers={[acknowledged.id]:"原本で確認した架空氏名",[excluded.id]:"対象外なので転記しない回答",[locked.id]:locked.initialValue,[normal.id]:"別の合法な架空回答"},output=await session.export({fields,answers,allowIncomplete:true,fontBytes:await font()}),actual=await PDFDocument.load(output.bytes);
      expect(output.validated).toBe(true);expect(actual.getForm().getTextField("acknowledged").getText()).toBe(answers[acknowledged.id]);expect(actual.getForm().getTextField("normal").getText()).toBe(answers[normal.id]);expect(actual.getForm().getTextField("excluded").getText()).toBe("Excluded original");expect(actual.getForm().getTextField("locked").getText()).toBe("Read-only original");expect(actual.getForm().getTextField("locked").isReadOnly()).toBe(true);expect(session.getOriginalBytes()).toEqual(bytes);expect(acknowledged.templateBinding.review.state).toBe("manual-confirmed");expect(acknowledged.templateBinding.source.packageId).toBe("synthetic-package");
    }finally{await session.dispose();}
  });
});
