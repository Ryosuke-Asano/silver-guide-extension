import { pdfAnswerTypeCompatible,pdfFieldApplicability,pdfFieldReadOnly, quadToBox, type PdfAnswers, type PdfField, type PdfIssue, type PdfPageInfo } from "../../domain/pdf";
import { graphemes, isInside } from "./geometry";

/** Shared UI checks. The exporter repeats validation against the immutable original. */
export function validatePdfFields(fields:PdfField[],answers:PdfAnswers,pages:PdfPageInfo[],options:{allowIncomplete?:boolean;answerStatus?:Record<string,string>;inputMode?:"direct"}={}):PdfIssue[]{
  const issues:PdfIssue[]=[];const ids=new Set(fields.map(f=>f.id));const add=(field:PdfField,code:string,message:string,pageIndex?:number)=>issues.push({fieldId:field.id,code,message,severity:"error" as const,...(pageIndex!==undefined?{pageIndex}:{})});
  const dependencies=new Map<string,Set<string>>();for(const f of fields){const refs=new Set<string>();const collect=(node:NonNullable<PdfField["condition"]>,depth=0):void=>{if(depth>16)return;if("fieldId"in node)refs.add(node.fieldId);if("arg"in node)collect(node.arg,depth+1);if("args"in node)node.args.forEach(child=>collect(child,depth+1));};if(f.condition)collect(f.condition);dependencies.set(f.id,refs);}
  // A valid imported document can contain 5,000 linked questions. Iterative
  // Kosaraju traversal bounds stack use and identifies every member of a cycle,
  // including branches which rejoin an already visited part of a component.
  const reverse=new Map<string,Set<string>>();for(const id of dependencies.keys())reverse.set(id,new Set());for(const [id,refs]of dependencies)for(const ref of refs)reverse.get(ref)?.add(id);
  const visited=new Set<string>(),order:string[]=[];for(const first of dependencies.keys()){if(visited.has(first))continue;visited.add(first);const stack:Array<{id:string;edges:Iterator<string>}>=[{id:first,edges:dependencies.get(first)!.values()}];while(stack.length){const current=stack.at(-1)!,next=current.edges.next();if(next.done){order.push(current.id);stack.pop();continue;}const id=next.value;if(!dependencies.has(id)||visited.has(id))continue;visited.add(id);stack.push({id,edges:dependencies.get(id)!.values()});}}
  const cyclic=new Set<string>(),assigned=new Set<string>();for(let index=order.length-1;index>=0;index--){const first=order[index];if(assigned.has(first))continue;const component:string[]=[],stack=[first];assigned.add(first);while(stack.length){const id=stack.pop()!;component.push(id);for(const ref of reverse.get(id)??[])if(!assigned.has(ref)){assigned.add(ref);stack.push(ref);}}if(component.length>1||dependencies.get(first)?.has(first))for(const id of component)cyclic.add(id);}
  for(const field of fields){if(pdfFieldReadOnly(field)||field.mappingState==="rejected")continue;
    if(field.required==="unknown")add(field,"REQUIRED_UNCONFIRMED",`「${field.label}」の必須・任意の指定を原書類で確認してください。保留や未記入の出力許可で、この確認は省略できません。`);
    const value=Object.prototype.hasOwnProperty.call(answers,field.id)?answers[field.id]:field.initialValue;
    // These boundaries precede empty/conditional/incomplete skips. A legacy
    // empty array in a text field is still a wrong type, and an unchecked or
    // empty retained answer can still require the person's explicit review.
    if(!pdfAnswerTypeCompatible(field,value)){add(field,"ANSWER_TYPE","保持している回答の種類が、この欄の入力形式と合いません。原書類を確認して入力し直してください。保持している回答を自動では変換しません。");continue;}
    if(options.answerStatus?.[field.id]==="needs-review")add(field,"ANSWER_REVIEW_REQUIRED",`「${field.label}」の保持している回答を確認してください。保留や未記入の出力許可で、この確認は省略できません。`);
    const selectedOptions=!field.native&&(field.kind==="radio"||field.kind==="select")&&value!==null&&value!==undefined&&value!==""?(Array.isArray(value)?value:[String(value)]).flatMap(selected=>field.options.find(option=>option.id===selected||option.exportValue===selected)?.placements??[]):[];
    const placementPages=new Set([...field.placements,...selectedOptions].map(placement=>placement.pageIndex));let pageConflict=false;
    for(const pageIndex of placementPages){const review=pages[pageIndex]?.review;if(review!=="no-inputs-confirmed"&&review!=="excluded")continue;pageConflict=true;add(field,"PAGE_CLASSIFICATION_CONFLICT",`${pageIndex+1}ページは${review==="excluded"?"今回の記入対象外":"入力欄がないと確認済み"}ですが、「${field.label}」の記入先があります。ページの判断か項目の対象指定を見直してください。`,pageIndex);}
    if(pageConflict)continue;
    // A changed source/position is a review boundary, even for an empty answer.
    // Completion and mapping flags cannot replace the person's original review.
    if(field.templateBinding?.review.state==="needs-review"){add(field,"TEMPLATE_REVIEW_REQUIRED",`「${field.label}」に採用した様式の案内が変わったか、現在確認できません。元の書類で記入場所と内容を確認してください。`);continue;}
    let applicable:boolean|"unknown";try{applicable=pdfFieldApplicability(field,answers,options);}catch{add(field,"CONDITION_INVALID","項目の条件を確認してください。");continue;}
    if(cyclic.has(field.id))add(field,"CONDITION_CYCLE","項目の条件が互いを参照しています。原書類の条件を見直してください。");
    if(field.required!=="unknown"&&!field.requiredSource?.text.trim()&&!field.native)add(field,"REQUIRED_SOURCE_UNCONFIRMED","必須・任意の指定の根拠を原書類で確認してください。");
    if(field.required!=="unknown"&&field.native?.originalRequired!==undefined&&field.required!==field.native.originalRequired&&field.requiredSource?.kind!=="document")add(field,"REQUIRED_SOURCE_UNCONFIRMED","元PDFの必須指定を変更する場合は、原書類の文章の根拠を確認してください。");
    if(field.conditionStatus==="confirmed"&&!field.conditionSource?.text.trim())add(field,"CONDITION_SOURCE_UNCONFIRMED","この欄に記入する条件の原文を確認してください。");
    if(field.condition){const check=(node:NonNullable<PdfField["condition"]>,depth=0):void=>{if(depth>16)throw Error();if("fieldId"in node&&!ids.has(node.fieldId))throw Error();if("args"in node)node.args.forEach(n=>check(n,depth+1));if("arg"in node)check(node.arg,depth+1);};try{check(field.condition);}catch{add(field,"CONDITION_INVALID","条件が参照する項目を確認してください。");}}
    const empty=value===null||value===undefined||value===""||field.kind==="checkbox"&&value===false||Array.isArray(value)&&!value.length;
    if(applicable===false){if(!empty)add(field,"CONDITION_NOT_APPLICABLE","条件に該当しない欄に回答があります。内容を確認してください。");continue;}
    if(applicable==="unknown")add(field,"CONDITION_UNCONFIRMED","この項目に記入する条件を原書類で確認してください。");
    if(field.required===true&&empty&&!options.allowIncomplete)add(field,"REQUIRED_EMPTY",`「${field.label}」が未記入です。`);if(empty)continue;
    if(field.role==="unknown")add(field,"ROLE_UNCONFIRMED",`「${field.label}」の記入者を確認してください。`);
    if(!["confirmed","manual"].includes(field.mappingState))add(field,"MAPPING_UNCONFIRMED",`「${field.label}」の記入場所と意味を確認してください。`);
    if(!field.placements.length)add(field,"PLACEMENT_MISSING","記入場所を設定してください。");
    for(const p of field.placements){const page=pages[p.pageIndex];if(!page||!isInside(p.quad,page.visibleBox))add(field,"INVALID_PLACEMENT","記入枠が用紙の範囲外にあります。");for(const cell of p.cells??[])if(!isInside(cell,quadToBox(p.quad)))add(field,"INVALID_CELL","マス目が記入枠の範囲外にあります。");}
    if(field.kind==="unknown"||field.kind==="signature")add(field,"FIELD_TYPE_UNSUPPORTED","項目の種類を確認してください。");
    const text=typeof value==="string"?value:Array.isArray(value)?value.join("、"):"";
    if(field.maxGraphemes!==null&&graphemes(text).length>field.maxGraphemes)add(field,"GRAPHEME_LIMIT",`${field.maxGraphemes} 文字の制限を超えています。`);
    if(field.native?.maxLength!==null&&field.native?.maxLength!==undefined&&text.length>field.native.maxLength)add(field,"NATIVE_LENGTH_LIMIT","PDF の入力欄の文字数制限を超えています。");
    if(field.style?.fontSizePt!==undefined&&(!Number.isFinite(field.style.fontSizePt)||field.style.fontSizePt<=0||field.style.fontSizePt>100))add(field,"FONT_SIZE_INVALID","文字サイズを 0 より大きく 100pt 以下にしてください。");
    if((field.style?.fontSizePt??14)<10&&!field.style?.allowSmallFont)add(field,"SMALL_FONT_UNCONFIRMED","10pt より小さい文字を使う場合は拡大プレビューで確認してください。");
    if((field.kind==="radio"||field.kind==="select")&&!field.native?.editableSelect)for(const selected of Array.isArray(value)?value:[String(value)]){const option=field.options.find(o=>o.id===selected||o.exportValue===selected);if(!option)add(field,"UNKNOWN_OPTION","原書類にない選択肢です。");else if(!field.native){if(!option.placements.length)add(field,"OPTION_PLACEMENT_MISSING","選択印を付ける場所がありません。");for(const p of option.placements){const page=pages[p.pageIndex];if(!page||!isInside(p.quad,page.visibleBox))add(field,"INVALID_OPTION_PLACEMENT","選択印が用紙の範囲外にあります。");}}}
  }
  // Direct entry is an editor, not a declaration that inferred semantics were
  // verified. Keep unknown metadata unchanged and validate the actual answer,
  // immutable PDF restrictions and geometry without a confirmation workflow.
  if(options.inputMode==="direct"){
    const metadataChecks=new Set(["REQUIRED_UNCONFIRMED","REQUIRED_SOURCE_UNCONFIRMED","ROLE_UNCONFIRMED","MAPPING_UNCONFIRMED","CONDITION_UNCONFIRMED","CONDITION_SOURCE_UNCONFIRMED"]);
    return issues.filter(issue=>!metadataChecks.has(issue.code));
  }
  return issues;
}
