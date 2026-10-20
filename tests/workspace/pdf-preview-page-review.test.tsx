// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PdfPreview} from "../../src/apps/workspace/PdfPreview";
import {makeManualPdfField,type PdfField,type PdfPageInfo} from "../../src/domain/pdf";

let container:HTMLDivElement,root:Root;
const page:PdfPageInfo={index:0,label:"1",mediaBox:[0,0,595,842],cropBox:[0,0,595,842],visibleBox:[0,0,595,842],rotation:0,userUnit:1,widthPt:595,heightPt:842,extraction:"native",review:"inputs-confirmed"};
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
function candidates():PdfField[]{const active=makeManualPdfField(0,[100,620,300,650],"記入する氏名");active.id="active-question";return [active,...Array.from({length:625},(_,index)=>({...makeManualPdfField(0,[30,200,60,220],String(index+1)),id:`excluded-${index}`,mappingState:"rejected" as const}))];}

describe("actual preview makes excluded geometry opt-in",()=>{
  it("keeps 625 rejected shapes out of the ordinary focusable overlay tree while preserving the original canvas and the remaining question",async()=>{
    const fields=candidates(),before=structuredClone(fields),selected=vi.fn();await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId={null} pageIndex={0} onPageChange={()=>{}} onSelect={selected}/>));
    expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe("1ページの原書類");const overlays=container.querySelectorAll<HTMLButtonElement>(".pdf-field-overlay");expect(overlays).toHaveLength(1);expect(overlays[0].getAttribute("aria-label")).toContain("記入する氏名");
    await act(async()=>{overlays[0].focus();overlays[0].click();});expect(document.activeElement).toBe(overlays[0]);expect(selected).toHaveBeenCalledExactlyOnceWith("active-question");expect(fields).toEqual(before);
  });
  it("exposes original-position inspection of rejected shapes only after explicitly enabling them, without claiming they are input questions",async()=>{
    const fields=candidates(),before=structuredClone(fields),selected=vi.fn();const render=async(showRejected:boolean)=>act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId="excluded-0" pageIndex={0} onPageChange={()=>{}} onSelect={selected} showRejected={showRejected}/>));
    await render(true);expect(container.querySelectorAll(".pdf-field-overlay")).toHaveLength(626);const excluded=container.querySelector<HTMLButtonElement>('.pdf-field-overlay[aria-pressed="true"]')!;expect(excluded.getAttribute("aria-label")).toContain("対象外の候補の位置と内容を確認");expect(excluded.getAttribute("aria-label")).not.toContain("質問へ移動");
    await act(async()=>excluded.click());expect(selected).toHaveBeenCalledExactlyOnceWith("excluded-0");expect(fields).toEqual(before);await render(false);expect(container.querySelectorAll(".pdf-field-overlay")).toHaveLength(1);expect(container.querySelector("canvas")).not.toBeNull();
  });
});

describe("large per-page selection is complete and preserves original positions",()=>{
  it("labels the selected large location with visible text while keeping every original overlay focusable",async()=>{
    const fields=[makeManualPdfField(0,[80,500,81,501],"同じ名前"),makeManualPdfField(0,[140,500,141,501],"同じ名前")],before=structuredClone(fields),selected=vi.fn();
    await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId={fields[1].id} pageIndex={0} onPageChange={()=>{}} onSelect={selected}/>));
    const current=container.querySelector<HTMLButtonElement>('.pdf-position-list button[aria-pressed="true"]')!;expect(current.dataset.fieldId).toBe(fields[1].id);expect(current.querySelector(".pdf-selection-label")?.textContent).toBe("選択中");expect(container.querySelectorAll(".pdf-position-list .pdf-selection-label")).toHaveLength(1);
    const overlays=[...container.querySelectorAll<HTMLButtonElement>(".pdf-field-overlay")];expect(overlays).toHaveLength(2);expect(overlays.every(button=>!button.disabled&&button.tabIndex===0)).toBe(true);expect(container.querySelector(".pdf-position-picker h3")?.getAttribute("tabindex")).toBe("-1");expect(container.querySelector(".pdf-position-picker h3")?.id).toBeTruthy();expect(fields).toEqual(before);expect(selected).not.toHaveBeenCalled();
  });

  it("explains page-boundary disabled navigation next to the visible page and zoom labels",async()=>{
    await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={[]} selectedId={null} pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}}/>));
    for(const name of ["前のページ","次のページ"]){const button=container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;expect(button.disabled).toBe(true);expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe("この書類は1ページです。");}
    expect([...container.querySelectorAll("label>span")].map(span=>span.textContent)).toContain("ページ番号");expect([...container.querySelectorAll("label>span")].map(span=>span.textContent)).toContain("原本の拡大率");
  });

  it("makes option-only, same-name and multiple-widget locations choose the exact current-page identity through both paths",async()=>{
    const first=makeManualPdfField(0,[80,500,140,520],"同名","radio"),second=makeManualPdfField(1,[240,500,300,520],"同名","radio");first.id="same-name-a";second.id="same-name-b";
    first.options=[{id:"first-direct-alias",label:"同じ原位置",exportValue:"a",placements:[structuredClone(first.placements[0])]},{id:"first-page2",label:"別ページの選択肢",exportValue:"b",placements:[{...structuredClone(first.placements[0]),pageIndex:1}]}];
    const only=structuredClone(second.placements[0]);second.placements=[];second.options=[{id:"option-only",label:"選択肢だけの位置",exportValue:"c",placements:[only]}];
    const fields=[first,second],before=structuredClone(fields),selected=vi.fn(),oldPath=vi.fn(),pages=[page,{...page,index:1,label:"2"}];
    await act(async()=>root.render(<PdfPreview session={null} pages={pages} fields={fields} selectedId={null} pageIndex={1} onPageChange={()=>{}} onSelect={oldPath} onSelectLocation={selected}/>));
    const rows=container.querySelectorAll<HTMLButtonElement>(".pdf-position-list button"),overlays=container.querySelectorAll<HTMLButtonElement>(".pdf-field-overlay");expect(rows).toHaveLength(2);expect(overlays).toHaveLength(2);
    for(let index=0;index<2;index++){expect(rows[index].dataset.locationKey).toBe(overlays[index].dataset.locationKey);expect(rows[index].dataset.fieldId).toBe(overlays[index].dataset.fieldId);await act(async()=>rows[index].click());await act(async()=>overlays[index].click());}
    expect(selected.mock.calls).toEqual([[first.id,1],[first.id,1],[second.id,1],[second.id,1]]);expect(oldPath).not.toHaveBeenCalled();expect(rows[1].textContent).toContain("選択肢だけの位置");expect(fields).toEqual(before);
  });

  it("exposes every one of625 dense locations through pagination without mounting625 large buttons or changing source data",async()=>{
    const fields=Array.from({length:625},(_,index)=>({...makeManualPdfField(0,[30+(index%25),200,31+(index%25),201],"1"),id:`dense-${index}`})),before=structuredClone(fields),selected=vi.fn();
    await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId={null} pageIndex={0} onPageChange={()=>{}} onSelect={selected}/>));
    // Invoke every real row's handler, batching only within the25 mounted rows.
    // The final compiled browser check separately observes each selected state.
    const visited:string[]=[];for(let listPage=0;listPage<25;listPage++){const rows=container.querySelectorAll<HTMLButtonElement>(".pdf-position-list button");expect(rows).toHaveLength(25);await act(async()=>{for(const row of rows){visited.push(row.dataset.fieldId!);row.click();}});if(listPage<24){const next=[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="次の25か所を表示")!;await act(async()=>next.click());expect(document.activeElement).toBe(container.querySelector(".pdf-position-picker h3"));}}
    expect(visited).toEqual(fields.map(field=>field.id));expect(selected.mock.calls.map(call=>call[0])).toEqual(fields.map(field=>field.id));expect(fields).toEqual(before);expect(container.querySelectorAll(".pdf-field-overlay")).toHaveLength(625);
  });

  it("number navigation focuses the requested large button without silently selecting or changing an answer, including repeated same-number requests",async()=>{
    const fields=Array.from({length:60},(_,index)=>({...makeManualPdfField(0,[30,200,31,201],"番号"),id:`number-${index}`})),selected=vi.fn();await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId={null} pageIndex={0} onPageChange={()=>{}} onSelect={selected}/>));
    const input=container.querySelector<HTMLInputElement>(".pdf-position-navigation input")!,go=[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="番号のボタンへ移動")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"58");input.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>go.click());expect(document.activeElement?.getAttribute("data-field-id")).toBe("number-57");expect(selected).not.toHaveBeenCalled();go.focus();await act(async()=>go.click());expect(document.activeElement?.getAttribute("data-field-id")).toBe("number-57");
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"999");input.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>go.click());expect(container.querySelector(".pdf-position-picker [role=status]")?.textContent).toContain("表示している位置の番号");expect(input.getAttribute("aria-invalid")).toBe("true");expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("表示している位置の番号");expect(selected).not.toHaveBeenCalled();
  });

  it("starts each next/previous batch and original page at the beginning instead of retaining the previous batch's bottom scroll",async()=>{
    const fields=[...Array.from({length:60},(_,index)=>({...makeManualPdfField(0,[30,200,31,201],"1"),id:`scroll-first-${index}`})),...Array.from({length:30},(_,index)=>({...makeManualPdfField(1,[30,200,31,201],"2"),id:`scroll-second-${index}`}))],before=structuredClone(fields),selected=vi.fn(),pages=[page,{...page,index:1,label:"2"}];
    const render=async(index:number,showRejected=false)=>act(async()=>root.render(<PdfPreview session={null} pages={pages} fields={fields} selectedId={null} pageIndex={index} onPageChange={()=>{}} onSelect={selected} showRejected={showRejected}/>));
    const list=()=>container.querySelector<HTMLDivElement>(".pdf-position-list")!;
    const button=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(candidate=>candidate.textContent===name)!;
    await render(0);list().scrollTop=2656;await act(async()=>button("次の25か所を表示").click());expect(list().scrollTop).toBe(0);expect(list().firstElementChild?.getAttribute("data-field-id")).toBe("scroll-first-25");expect(document.activeElement).toBe(container.querySelector(".pdf-position-picker h3"));
    list().scrollTop=2656;await act(async()=>button("前の25か所を表示").click());expect(list().scrollTop).toBe(0);expect(list().firstElementChild?.getAttribute("data-field-id")).toBe("scroll-first-0");
    list().scrollTop=2656;await render(1);expect(list().scrollTop).toBe(0);expect(list().firstElementChild?.getAttribute("data-field-id")).toBe("scroll-second-0");
    list().scrollTop=2656;await render(1,true);expect(list().scrollTop).toBe(0);expect(fields).toEqual(before);expect(selected).not.toHaveBeenCalled();
  });

  it("resets a new batch before number-jump focus scrolls to its requested row, and preserves that row on a repeated jump",async()=>{
    const fields=Array.from({length:60},(_,index)=>({...makeManualPdfField(0,[30,200,31,201],"番号"),id:`focus-scroll-${index}`})),before=structuredClone(fields),selected=vi.fn();
    await act(async()=>root.render(<PdfPreview session={null} pages={[page]} fields={fields} selectedId={null} pageIndex={0} onPageChange={()=>{}} onSelect={selected}/>));
    const list=container.querySelector<HTMLDivElement>(".pdf-position-list")!,input=container.querySelector<HTMLInputElement>(".pdf-position-navigation input")!,go=[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="番号のボタンへ移動")!;
    const originalFocus=HTMLElement.prototype.focus,scrollBeforeFocus:number[]=[];
    const focus=vi.spyOn(HTMLElement.prototype,"focus").mockImplementation(function(this:HTMLElement,options?:FocusOptions){if(this.dataset.fieldId==="focus-scroll-57"){scrollBeforeFocus.push(list.scrollTop);list.scrollTop=700;}originalFocus.call(this,options);});
    try{list.scrollTop=2656;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"58");input.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>go.click());expect(scrollBeforeFocus).toEqual([0]);expect(list.scrollTop).toBe(700);expect(document.activeElement?.getAttribute("data-field-id")).toBe("focus-scroll-57");
      go.focus();await act(async()=>go.click());expect(scrollBeforeFocus).toEqual([0,700]);expect(list.scrollTop).toBe(700);expect(document.activeElement?.getAttribute("data-field-id")).toBe("focus-scroll-57");expect(selected).not.toHaveBeenCalled();expect(fields).toEqual(before);
    }finally{focus.mockRestore();}
  });
});
