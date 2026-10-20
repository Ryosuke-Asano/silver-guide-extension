import { useEffect, useId, useRef, useState } from "react";
import { makeManualPdfField, pdfAnswerTypeCompatible, pdfFieldPageIndices, pdfFieldReadOnly, pdfFieldSourceReadOnly, quadToBox, rectToQuad, type PdfAnswer, type PdfBox, type PdfField } from "../../domain/pdf";
import { getDirectPdfTaskIssues, restorePdfMappingSnapshot, snapshotPdfMapping, type PdfTask } from "./task-model";
import type { usePdfWorkspace } from "./usePdfWorkspace";
import { PdfPreview } from "./PdfPreview";
import { PdfFieldTools } from "./PdfFieldTools";

type Controller = ReturnType<typeof usePdfWorkspace>;
type Correction = { taskId: string; baseRevision: number; field: PdfField; adding: boolean; returnPageIndex: number };
const empty = (value: PdfAnswer | undefined) => value == null || value === "" || value === false || Array.isArray(value) && value.length === 0;

export function PdfWorkspace({ controller }: { controller: Controller }) {
  const { task, update } = controller;
  const [pageIndex, setPageIndex] = useState(0);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [composingField,setComposingField]=useState<{taskId:string;fieldId:string}|null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId(), answerId = useId(), hintId = useId();
  const question = useRef<HTMLElement>(null), focusNext = useRef(true), correctionHeading = useRef<HTMLHeadingElement>(null);
  const fields = task?.fields.filter(field => field.mappingState !== "rejected") ?? [];
  const selected = fields.find(field => field.id === task?.selectedFieldId) ?? fields[0];
  const index = fields.findIndex(field => field.id === selected?.id);
  const busy = ["loading", "analyzing", "exporting", "validating", "downloading"].includes(controller.state);
  const viewOnly = task?.analysis.document.capabilities.export.allowed === false;
  const readOnly = viewOnly || !selected || pdfFieldReadOnly(selected);
  const answer = selected && task ? (Object.hasOwn(task.answers, selected.id) ? task.answers[selected.id] : selected.initialValue) : null;
  useEffect(() => { setCorrection(null); setDrawing(false); setProblem(null); setPageIndex(0); focusNext.current = true; }, [task?.id]);
  useEffect(() => {
    if (!selected || correction) return;
    const pages = pdfFieldPageIndices(selected);
    setPageIndex(current => pages.includes(current) ? current : pages[0] ?? 0);
    if (focusNext.current) {
      focusNext.current = false;
      (question.current?.querySelector<HTMLElement>("[data-pdf-answer]") ?? question.current?.querySelector<HTMLElement>("h2"))?.focus({ preventScroll: true });
    }
  }, [task?.id, selected?.id, correction]);
  useEffect(() => { if (correction) correctionHeading.current?.focus({ preventScroll: true }); }, [Boolean(correction)]);
  if (!task) return null;

  const remember = (current: PdfTask) => ({ mappingHistory: [...(current.mappingHistory ?? []), snapshotPdfMapping(current)].slice(-20), mappingRedo: [] });
  const select = (id: string, locationPage?: number) => {
    if (busy || correction) return;
    focusNext.current = true; setProblem(null);
    if (locationPage !== undefined) setPageIndex(locationPage);
    update(() => ({ selectedFieldId: id }));
  };
  const setAnswer = (value: PdfAnswer) => {
    if (!selected || readOnly || busy || correction) return;
    update(current => ({ answers: { ...current.answers, [selected.id]: value }, ...(current.answerFormats?.[selected.id] ? { answerFormats: { ...current.answerFormats, [selected.id]: { ...current.answerFormats[selected.id], active: false } } } : {}), answerStatus: { ...current.answerStatus, [selected.id]: empty(value) ? "empty" : "entered" }, stage: "filling" }));
    setProblem(null);
  };
  const next = () => {
    if (busy || correction) return;
    const current = controller.taskRef.current;
    if (!current) return;
    // Moving forward accepts the visible answer, without certifying inferred metadata.
    const value = selected ? (Object.hasOwn(current.answers, selected.id) ? current.answers[selected.id] : selected.initialValue) : null;
    const accepted = selected && !readOnly && pdfAnswerTypeCompatible(selected, value)
      ? { ...current, answerStatus: { ...current.answerStatus, [selected.id]: empty(value) ? "empty" as const : "entered" as const } } : current;
    const issues = getDirectPdfTaskIssues(accepted);
    const issue = index < fields.length - 1 ? issues.find(item => item.fieldId === selected?.id) : issues[0];
    if (issue) { if (issue.fieldId && issue.fieldId !== selected?.id) select(issue.fieldId, issue.pageIndex); setProblem(issue.message); return; }
    focusNext.current = true;
    update(() => ({ ...(selected && accepted.answerStatus[selected.id] !== current.answerStatus[selected.id] ? { answerStatus: accepted.answerStatus } : {}), ...(index < fields.length - 1 ? { selectedFieldId: fields[index + 1].id } : {}) }));
    setProblem(null);
    if (index === fields.length - 1 && !viewOnly) void controller.savePdfDirect();
  };
  const beginCorrection = (adding = false) => {
    if (viewOnly || busy || adding && task.fields.length >= 5000) return;
    const visible = task.pages[pageIndex]?.visibleBox;
    if (!visible || !adding && !selected) return;
    const [x0,y0,x1,y1]=visible;
    const field=adding?makeManualPdfField(pageIndex,[x0+(x1-x0)*.2,y0+(y1-y0)*.5,x0+(x1-x0)*.8,y0+(y1-y0)*.56]):structuredClone(selected!);
    setCorrection({taskId:task.id,baseRevision:task.revision,field,adding,returnPageIndex:pageIndex});setDrawing(false);setProblem(null);
  };
  const changeCorrection = (change: Partial<PdfField>) => setCorrection(current => current ? { ...current, field: { ...current.field, ...change } } : current);
  const closeCorrection = (restorePage = true) => { if(restorePage && correction) setPageIndex(correction.returnPageIndex); setCorrection(null); setDrawing(false); setProblem(null); focusNext.current = true; };
  const applyCorrection = () => {
    const current=controller.taskRef.current;
    if(!correction||!current||busy)return;
    if(current.id!==correction.taskId||current.revision!==correction.baseRevision){setProblem("入力内容が変わりました。修正を取り消し、もう一度この項目を開いてください。");return;}
    if(!correction.field.label.trim()){setProblem("項目名を入力してください。");return;}
    const field={...correction.field,revision:correction.field.revision+1};
    const after=correction.adding?[...current.fields,field]:current.fields.map(item=>item.id===field.id?field:item);
    const selectedId=field.mappingState!=="rejected"?field.id:after.find(item=>item.mappingState!=="rejected")?.id??null;
    update(previous=>({...remember(previous),fields:after,selectedFieldId:selectedId,stage:"filling",...(correction.adding?{answers:{...previous.answers,[field.id]:null},answerStatus:{...previous.answerStatus,[field.id]:"empty" as const}}:{})}));
    closeCorrection(false);
  };
  const undoCorrection = () => {
    const current=controller.taskRef.current,previous=current?.mappingHistory?.at(-1);
    if(!current||!previous||busy)return;
    try{update(()=>({...restorePdfMappingSnapshot(current,previous),mappingHistory:current.mappingHistory?.slice(0,-1)}));closeCorrection();}
    catch(error){setProblem(error instanceof Error?error.message:"修正を元に戻せませんでした。");}
  };
  const hint=selected?fieldHint(selected):null;
  const unfilled=fields.filter(field=>!pdfFieldReadOnly(field)&&empty(Object.hasOwn(task.answers,field.id)?task.answers[field.id]:field.initialValue)).length;
  const previewFields=correction?(correction.adding?[...task.fields,correction.field]:task.fields.map(field=>field.id===correction.field.id?correction.field:field)):task.fields;
  return <section className="pdf-entry" aria-label="PDFに記入">
    <p className="pdf-entry-title" title={task.title}>{task.title}</p>
    <div className="pdf-entry-layout">
      <section ref={question} className="pdf-entry-form" aria-label="入力欄">
        {correction ? <section className="pdf-entry-tools" aria-label="この項目を直す">
          <h2 ref={correctionHeading} tabIndex={-1}>{correction.adding?"入力欄を追加":"この項目を直す"}</h2>
          <p className="pdf-entry-hint">原本を見ながら、必要なところだけ直してください。回答はそのまま残ります。</p>
          <FieldEditor field={correction.field} disabled={busy} onChange={changeCorrection}/>
          <button type="button" disabled={busy} aria-pressed={drawing} onClick={()=>setDrawing(value=>!value)}>{drawing?"囲む操作をやめる":"原本を囲んで記入場所を直す"}</button>
          {drawing&&<p role="status">原本の記入する枠をドラッグで囲んでください。</p>}
          <details className="pdf-correction-details"><summary>文字・選択肢などの修正</summary>
            <fieldset disabled={busy}><legend className="visually-hidden">追加の修正</legend>
              <PdfFieldTools field={correction.field} onChangeField={changeCorrection}/>
              <label>文字数の上限<input type="number" min={0} max={10000} value={correction.field.maxGraphemes??0} onChange={event=>{const value=Number(event.target.value);if(Number.isInteger(value)&&value>=0&&value<=10000)changeCorrection({maxGraphemes:value||null});}}/><small>0 は上限を指定しません。元PDFの制限は残ります。</small></label>
              {!pdfFieldSourceReadOnly(correction.field)&&correction.field.kind!=="signature"&&<label className="check-row"><input type="checkbox" checked={!pdfFieldReadOnly(correction.field)} onChange={event=>changeCorrection({readOnly:!event.target.checked,...(event.target.checked&&["office","signature"].includes(correction.field.role)?{role:"unknown" as const}:{})})}/>自分が記入する欄</label>}
              {!correction.adding&&<label className="check-row"><input type="checkbox" checked={correction.field.mappingState==="rejected"} onChange={event=>changeCorrection({mappingState:event.target.checked?"rejected":"needs-review"})}/>今回はこの項目を記入しない</label>}
            </fieldset>
            {!!task.mappingHistory?.length&&<button type="button" disabled={busy} onClick={undoCorrection}>直前の修正を元に戻す</button>}
            {!correction.adding&&<button type="button" disabled={busy||task.fields.length>=5000} onClick={()=>beginCorrection(true)}>足りない入力欄を追加</button>}
          </details>
          {problem&&<p className="pdf-entry-error" role="alert">{problem}</p>}
          <div className="pdf-entry-navigation"><button type="button" disabled={busy} onClick={()=>closeCorrection()}>取消</button><button type="button" className="primary" disabled={busy} onClick={applyCorrection}>修正を採用</button></div>
        </section> : selected ? <>
          <p className="pdf-entry-progress">{index+1} / {fields.length}</p>
          <h2 id={headingId} tabIndex={-1}><label htmlFor={answerId}>{selected.label}{selected.required===true&&<small>必須</small>}</label></h2>
          {hint&&<p id={hintId} className="pdf-entry-hint">{hint}</p>}
          {readOnly?<><p className="pdf-entry-readonly">{viewOnly?task.analysis.document.capabilities.export.reason??"このPDFは読み取り専用です。":"この欄は記入対象外です。原本の内容を確認して次へ進めます。"}</p><p className="pdf-entry-existing">{String(selected.initialValue??"")}</p></>:<PdfAnswerInput field={selected} answer={answer} id={answerId} hintId={hint?hintId:undefined} invalid={!!problem} disabled={busy} onChange={setAnswer} onCompositionChange={composing=>setComposingField(composing?{taskId:task.id,fieldId:selected.id}:null)}/>}
          {!viewOnly&&<button type="button" className="pdf-correct-link" disabled={busy} onClick={()=>beginCorrection()}>この項目を直す</button>}
          {problem&&<p className="pdf-entry-error" role="alert">{problem}</p>}
          <div className="pdf-entry-bottom">
            <div className="pdf-entry-navigation"><button type="button" disabled={index<=0||busy} onClick={()=>select(fields[index-1].id)}>戻る</button><button type="button" className="primary" disabled={busy||viewOnly&&index===fields.length-1} onClick={next}>{busy?"処理しています…":index===fields.length-1&&!viewOnly?"PDFを保存":"次へ"}</button></div>
            <p className="pdf-entry-footnote">{index===fields.length-1&&!viewOnly?unfilled?`未入力の${unfilled}項目を含めて保存します。`:"記入したPDFを保存します。申請の送信は行いません。":"最後の項目で「PDFを保存」に変わります。"}</p>
          </div>
        </> : <><h2 tabIndex={-1}>入力欄が見つかりませんでした</h2><p className="pdf-entry-hint">{viewOnly?task.analysis.document.capabilities.export.reason:"読み取りの結果は完全ではありません。原本で記入場所を指定できます。"}</p>{!viewOnly&&<button type="button" className="primary" disabled={busy} onClick={()=>beginCorrection(true)}>入力欄を追加</button>}</>}
      </section>
      <div className="pdf-entry-original"><PdfPreview compact session={controller.session.current} pages={task.pages} fields={previewFields} selectedId={correction?.field.id??selected?.id??null} pageIndex={pageIndex} onPageChange={setPageIndex} onSelect={select} title={correction||viewOnly?"原本のPDF":"記入プレビュー"} preview={correction||viewOnly?undefined:{answers:task.answers,answerStatus:task.answerStatus,mode:task.exportMode,actionRemovalConfirmed:task.actionRemovalConfirmed,paused:composingField?.taskId===task.id&&composingField.fieldId===selected?.id}} drawing={drawing&&!busy} onDraw={(page,box)=>{if(correction&&!busy){changeCorrection({placements:correction.field.placements.map((placement,i)=>i===0?{...placement,pageIndex:page,quad:rectToQuad(box)}:placement)});setDrawing(false);}}}/></div>
    </div>
  </section>;
}

function PdfAnswerInput({ field, answer, id, hintId, invalid, disabled, onChange,onCompositionChange }: { field: PdfField; answer: PdfAnswer; id: string; hintId?: string; invalid: boolean; disabled: boolean; onChange: (value: PdfAnswer) => void;onCompositionChange:(composing:boolean)=>void }) {
  const props = { id, "data-pdf-answer": true, "aria-describedby": hintId, "aria-invalid": invalid || undefined, disabled,onCompositionStart:()=>onCompositionChange(true),onCompositionEnd:()=>onCompositionChange(false),onBlur:()=>onCompositionChange(false) };
  if (field.native?.multiSelect) return <fieldset className="pdf-entry-options"><legend className="visually-hidden">{field.label}</legend>{field.options.map((option, index) => { const value = option.exportValue ?? option.id, values = Array.isArray(answer) ? answer : []; return <label key={option.id}><input {...props} id={index === 0 ? id : `${id}-${index}`} type="checkbox" checked={values.includes(value)} onChange={event => onChange(event.target.checked ? [...values.filter(item => item !== value), value] : values.filter(item => item !== value))} />{option.label}</label>; })}</fieldset>;
  if (field.kind === "checkbox" && field.options.length <= 1) return <label className="pdf-entry-option"><input {...props} type="checkbox" checked={answer === true} onChange={event => onChange(event.target.checked)} />{field.options[0]?.label ?? "選択する"}</label>;
  if (["radio", "select"].includes(field.kind) && field.options.length && !field.native?.editableSelect) return <select {...props} value={typeof answer === "string" ? answer : ""} onChange={event => onChange(event.target.value)}><option value="">選んでください</option>{field.options.map(option => <option key={option.id} value={option.exportValue ?? option.id}>{option.label}</option>)}</select>;
  const value = typeof answer === "string" ? answer : "";
  if (field.kind === "multiline") return <textarea {...props} value={value} rows={4} onChange={event => onChange(event.target.value)} />;
  return <input {...props} type="text" inputMode={field.kind === "number" ? "decimal" : /電話/.test(field.label) ? "tel" : /メール/.test(field.label) ? "email" : "text"} value={value} autoComplete="off" onChange={event => onChange(event.target.value)} />;
}

function fieldHint(field: PdfField): string | null {
  if (/氏名|名前/.test(field.label)) return "書類に記載する氏名を入力してください。";
  if (/住所/.test(field.label)) return "番地・建物名まで入力してください。";
  if (/電話/.test(field.label)) return "市外局番から入力してください。";
  if (/メール/.test(field.label)) return "メールアドレスを入力してください。";
  if (field.kind === "date") return "原本の日付の表記に合わせて入力してください。";
  if (field.templateBinding?.review.state === "needs-review") return null;
  return field.description?.split(/\n/)[0]?.slice(0, 90) || null;
}

function FieldEditor({ field, disabled, onChange }: { field: PdfField; disabled: boolean; onChange: (change: Partial<PdfField>) => void }) {
  const placement = field.placements[0], box = placement ? quadToBox(placement.quad) : null;
  return <fieldset disabled={disabled} className="field-inspector">
    <legend className="visually-hidden">項目と記入枠</legend>
    <label>項目名<input value={field.label} maxLength={1000} onChange={event => onChange({ label: event.target.value })} /></label>
    <label>入力形式<select disabled={!!field.native} value={field.kind} onChange={event => onChange({ kind: event.target.value as PdfField["kind"] })}>
      {Object.entries({ text: "一行の文字", multiline: "複数行の文字", date: "日付", number: "数字", checkbox: "チェック欄", radio: "選択肢", select: "選択一覧", signature: "署名欄", unknown: "未判定" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {box && <details><summary>記入位置を数値で直す</summary><div className="geometry-inputs">
      {["左端","下端","右端","上端"].map((label,index)=><label key={label}>{label}<input type="number" step="0.5" value={Math.round(box[index]*10)/10} onChange={event=>{
        const next=[...box] as PdfBox;next[index]=Number(event.target.value);
        if(next.every(Number.isFinite)&&next[2]>next[0]&&next[3]>next[1])onChange({placements:field.placements.map((item,i)=>i===0?{...item,quad:rectToQuad(next)}:item)});
      }}/></label>)}
    </div></details>}
  </fieldset>;
}
