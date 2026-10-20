import { PdfEngineError, quadToBox, type PdfAffine, type PdfBox, type PdfPoint, type PdfQuad } from "../../domain/pdf";

export const IDENTITY: PdfAffine = [1, 0, 0, 1, 0, 0];
export function transformPoint(m: PdfAffine, p: PdfPoint): PdfPoint { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
export function transformQuad(m: PdfAffine, q: PdfQuad): PdfQuad { return q.map(p => transformPoint(m, p)) as PdfQuad; }
export function multiply(a: PdfAffine, b: PdfAffine): PdfAffine { return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]; }
export function inverse(m: PdfAffine): PdfAffine { const d=m[0]*m[3]-m[1]*m[2]; if (!Number.isFinite(d)||Math.abs(d)<1e-12) throw new PdfEngineError("SINGULAR_TRANSFORM", "画像の位置変換を復元できません。"); return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d]; }
export function area(b: PdfBox): number { return Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]); }
export function intersection(a: PdfBox,b: PdfBox): PdfBox { return [Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])]; }
export function overlaps(a: PdfBox,b: PdfBox, tolerance=0): boolean { return a[0]<b[2]+tolerance&&a[2]>b[0]-tolerance&&a[1]<b[3]+tolerance&&a[3]>b[1]-tolerance; }
export function iou(a: PdfBox,b: PdfBox): number { const n=area(intersection(a,b)); return n/(area(a)+area(b)-n||1); }
export function isInside(q: PdfQuad,outer: PdfBox,tolerance=0.5): boolean { const b=quadToBox(q); return b.every(Number.isFinite)&&b[0]>=outer[0]-tolerance&&b[1]>=outer[1]-tolerance&&b[2]<=outer[2]+tolerance&&b[3]<=outer[3]+tolerance&&area(b)>0; }
export function abortIfNeeded(signal?: AbortSignal): void { if(signal?.aborted) throw new DOMException("処理を中止しました。", "AbortError"); }
export function abortable<T>(promise: Promise<T>,signal?: AbortSignal,onAbort?:()=>void): Promise<T> { if(!signal)return promise; abortIfNeeded(signal); return new Promise((resolve,reject)=>{const abort=()=>{onAbort?.(); reject(new DOMException("処理を中止しました。","AbortError"));};signal.addEventListener("abort",abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));}); }
export async function sha256(bytes: Uint8Array): Promise<string> { const digest=await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes).buffer); return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join(""); }
export function graphemes(text: string): string[] { return Array.from(new Intl.Segmenter("ja",{granularity:"grapheme"}).segment(text),s=>s.segment); }
