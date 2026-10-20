import type {PDFWorker} from "pdfjs-dist/types/src/display/api";

export type ValidationFaultPhase="loading"|"native"|"page"|"text"|"operators"|"cleanup";
export type ValidationFault={phase:ValidationFaultPhase;armed:boolean;claimed:boolean;held:boolean;destroyCalls:number;worker:PDFWorker|null;release:()=>void;onHeld:()=>void;destroyNever:boolean};
let current:ValidationFault|null=null;
export const fault=()=>current;
export function armFault(phase:ValidationFaultPhase,onHeld:()=>void){
  const value:ValidationFault={phase,armed:false,claimed:false,held:false,destroyCalls:0,worker:null,release:()=>{},onHeld,destroyNever:phase==="cleanup"};current=value;return value;
}
/** Hold only a real API result, never substitute document bytes or parser output. */
export function hold<T>(promise:Promise<T>,value:ValidationFault):Promise<T>{
  value.held=true;let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});value.release=release;
  void promise.catch(()=>{});queueMicrotask(value.onHeld);return gate.then(()=>promise);
}
export function clearFault(){current?.release();current=null;}
