import { useId } from "react";
import { quadToBox, rectToQuad, type PdfField, type PdfPlacement } from "../../domain/pdf";

/** Only the current field's output corrections. No profile, template or workflow controls. */
export function PdfFieldTools({field,onChangeField}:{field:PdfField;onChangeField:(change:Partial<PdfField>)=>void}){
  const id=useId();
  const update=(change:Partial<PdfField>)=>onChangeField({...change,mappingState:field.mappingState==="rejected"?"rejected":"needs-review"});
  const changeCells=(count:number)=>{
    if(!Number.isInteger(count)||count<0||count>100)return;
    update({maxGraphemes:count||null,placements:field.placements.map(placement=>{
      const q=placement.quad,lerp=(a:typeof q[0],b:typeof q[0],t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
      const {cells:_previousCells,...withoutCells}=placement;
      return count?{...withoutCells,cells:Array.from({length:count},(_,index)=>[lerp(q[0],q[1],index/count),lerp(q[0],q[1],(index+1)/count),lerp(q[3],q[2],(index+1)/count),lerp(q[3],q[2],index/count)] as typeof q)}:withoutCells;
    })});
  };
  return <div className="pdf-field-tools">
    <label htmlFor={`${id}-writing-mode`}>書く方向</label>
    <select id={`${id}-writing-mode`} value={field.placements[0]?.writingMode??"horizontal"} onChange={event=>update({placements:field.placements.map(placement=>({...placement,writingMode:event.target.value as PdfPlacement["writingMode"]}))})}><option value="horizontal">横書き</option><option value="vertical" disabled={Boolean(field.native)}>縦書き</option></select>
    {field.native?<p>元からの入力欄では、PDFに指定された向きと書式を保ちます。</p>:<>
      <label htmlFor={`${id}-cells`}>1文字ずつ入れるマスの数</label><input id={`${id}-cells`} type="number" min={0} max={100} value={field.placements[0]?.cells?.length??0} onChange={event=>changeCells(Number(event.target.value))}/><p>0 はマス目を使いません。</p>
    </>}
    {field.kind==="radio"||field.kind==="select"?<OptionEditor field={field} prefix={id} onChange={update}/>:null}
  </div>;
}

function OptionEditor({field,prefix,onChange}:{field:PdfField;prefix:string;onChange:(patch:Partial<PdfField>)=>void}){
  const add=()=>{const id=crypto.randomUUID();onChange({options:[...field.options,{id,label:"新しい選択肢",exportValue:id,placements:field.placements[0]?[structuredClone(field.placements[0])]:[]} ]});};
  const updateOption=(index:number,patch:Partial<PdfField["options"][number]>)=>onChange({options:field.options.map((option,i)=>i===index?{...option,...patch}:option)});
  return <fieldset><legend>選択肢と記入する場所</legend>{field.native?<p>元PDFの選択値と入力欄の対応を保ちます。</p>:null}{field.options.map((option,index)=><div key={option.id}><label htmlFor={`${prefix}-option-${index}`}>選択肢{index+1}</label><input id={`${prefix}-option-${index}`} value={option.label} onChange={event=>updateOption(index,{label:event.target.value})}/>{!field.native?option.placements.map((placement,placementIndex)=>{const box=quadToBox(placement.quad);return <fieldset key={placementIndex}><legend>{placement.pageIndex+1}ページの選択印</legend>{["左端","下端","右端","上端"].map((label,coordinate)=><label key={label}>{label}<input type="number" step="0.5" value={Math.round(box[coordinate]*10)/10} onChange={event=>{const next=[...box];next[coordinate]=Number(event.target.value);if(next[2]<=next[0]||next[3]<=next[1]||next.some(v=>!Number.isFinite(v)))return;updateOption(index,{placements:option.placements.map((p,i)=>i===placementIndex?{...p,quad:rectToQuad(next as [number,number,number,number])}:p)});}}/></label>)}</fieldset>;}):null}{!field.native?<button type="button" onClick={()=>onChange({options:field.options.filter((_,i)=>i!==index)})}>この選択肢を削除</button>:null}</div>)}{!field.native?<button type="button" onClick={add}>選択肢を追加する</button>:null}</fieldset>;
}
