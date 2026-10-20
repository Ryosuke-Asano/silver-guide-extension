import type { PdfAffine, PdfEvidence, PdfBox } from "../../domain/pdf";
import { inverse, multiply } from "./geometry";

export type PdfCanvas = HTMLCanvasElement | OffscreenCanvas;
export function createCanvas(width:number,height:number):PdfCanvas {
  if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(Math.max(1,Math.ceil(width)),Math.max(1,Math.ceil(height)));
  if(typeof document!=="undefined"){const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(width));canvas.height=Math.max(1,Math.ceil(height));return canvas;}
  throw new Error("CANVAS_UNAVAILABLE");
}
export function context2d(canvas:PdfCanvas):CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D { const context=canvas.getContext("2d",{willReadFrequently:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null;if(!context)throw new Error("CANVAS_UNAVAILABLE");return context; }

/** Metadata is a viewing instruction, not proof of the scan's text orientation.
 * Prefer raw horizontal scan rows; apply a declared quarter-turn when raw rows
 * are vertical. Real vertical writing without that viewing instruction stays vertical.
 */
export function chooseAnalysisRotation(data:Uint8ClampedArray,width:number,height:number,declaredRotation:number):0|90|180|270 {
  if(declaredRotation!==90&&declaredRotation!==270)return 0;
  const rows=new Float64Array(height),columns=new Float64Array(width);let ink=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]>100&&data[i]*.299+data[i+1]*.587+data[i+2]*.114<150){rows[y]++;columns[x]++;ink++;}}
  if(ink<100)return 0;const horizontal=rows.reduce((s,v)=>s+v*v,0),vertical=columns.reduce((s,v)=>s+v*v,0);
  return vertical>horizontal*1.15?declaredRotation:0;
}

/** Keep the affine for the selected OCR direction; the original canvas is untouched. */
export function rotateAnalysisCanvas(source:PdfCanvas,imageToPdf:PdfAffine,rotation:90|180|270):{canvas:PdfCanvas;imageToPdf:PdfAffine}{
  const swap=rotation!==180,target=createCanvas(swap?source.height:source.width,swap?source.width:source.height),context=context2d(target);
  const affine:PdfAffine=rotation===90?[0,1,-1,0,source.height,0]:rotation===180?[-1,0,0,-1,source.width,source.height]:[0,-1,1,0,0,source.width];
  context.fillStyle="white";context.fillRect(0,0,target.width,target.height);context.setTransform(...affine);context.drawImage(source as CanvasImageSource,0,0);
  return{canvas:target,imageToPdf:multiply(imageToPdf,inverse(affine))};
}

/** OCR confidence is only a local direction score, never calibrated field certainty. */
export function ocrDirectionScore(items:PdfEvidence[]):{characters:number;confidence:number}{let characters=0,weighted=0;for(const item of items){const count=[...item.text.replace(/[^\p{L}\p{N}]/gu,"")].length;if(!count)continue;const confidence=Number.isFinite(item.rawOcrConfidence)?item.rawOcrConfidence!:0;characters+=count;weighted+=count*confidence;}return{characters,confidence:characters?weighted/characters:0};}
export function preferOppositeOcr(primary:PdfEvidence[],opposite:PdfEvidence[]):boolean {const a=ocrDirectionScore(primary),b=ocrDirectionScore(opposite);return b.confidence>a.confidence+5&&b.characters>=Math.max(1,a.characters*.75);}

/** Long, sparse connected frame outlines give a continuous angle estimate.
 * Paragraph glyphs and filled regions are excluded. If no suitable frame is
 * present, refine the existing bounded projection estimate without changing
 * its decision that an upright page does not need correction.
 */
export function refineAnalysisSkew(data:Uint8ClampedArray,width:number,height:number,coarse:number):number {
  if(!Number.isFinite(coarse)||Math.abs(coarse)>3*Math.PI/180||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16_000_000||data.length<width*height*4)throw new Error("INVALID_DESKEW_INPUT");
  const dark=new Uint8Array(width*height);for(let i=0;i<dark.length;i++)dark[i]=data[i*4+3]>100&&data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114<185?1:0;
  const angles:Array<{angle:number;weight:number}>=[],scale=Math.max(width,height)/3508;
  for(let index=0;index<dark.length;index++){if(dark[index]!==1)continue;const stack=[index];dark[index]=2;let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,x0=width,x1=0,y0=height,y1=0;
    while(stack.length){const i=stack.pop()!,x=i%width,y=Math.floor(i/width);n++;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,j=yy*width+xx;if(xx>=0&&xx<width&&yy>=0&&yy<height&&dark[j]===1){dark[j]=2;stack.push(j);}}}
    const w=x1-x0+1,h=y1-y0+1,major=Math.max(w,h),minor=Math.min(w,h),fill=n/(w*h);if(major/minor<2.5||major<Math.max(80,120*scale)||minor<Math.max(8,12*scale)||fill>.25||fill<.005)continue;
    const theta=.5*Math.atan2(2*(sxy-sx*sy/n),(sxx-sx*sx/n)-(syy-sy*sy/n)),degrees=theta*180/Math.PI,residual=degrees-Math.round(degrees/90)*90,angle=-residual*Math.PI/180;
    if(Math.abs(angle)<=3*Math.PI/180)angles.push({angle,weight:major*major});
  }
  if(angles.length){angles.sort((a,b)=>a.angle-b.angle);const total=angles.reduce((s,a)=>s+a.weight,0);let cumulative=0;for(const a of angles){cumulative+=a.weight;if(cumulative>=total/2)return Math.abs(a.angle)<.1*Math.PI/180?0:a.angle;}}
  if(Math.abs(coarse)<.002)return 0;
  const step=Math.max(2,Math.ceil(Math.max(width,height)/700)),points:Array<[number,number]>=[];for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){const i=(y*width+x)*4;if(data[i+3]>100&&data[i]*.299+data[i+1]*.587+data[i+2]*.114<120)points.push([x-width/2,y-height/2]);}
  if(points.length<100)return coarse;let best=coarse,bestScore=-1;for(let n=-10;n<=10;n++){const angle=coarse+n*.05*Math.PI/180;if(Math.abs(angle)>3*Math.PI/180)continue;const s=Math.sin(angle),c=Math.cos(angle),bins=new Map<number,number>();for(const [x,y]of points){const bin=Math.round((x*s+y*c)/step);bins.set(bin,(bins.get(bin)??0)+1);}let score=0;for(const count of bins.values())score+=count*count;if(score>bestScore){bestScore=score;best=angle;}}return best;
}

/** Bounded projection-profile deskew. Keep the exact affine used for returned OCR coordinates. */
export function deskew(source:PdfCanvas,imageToPdf:PdfAffine,fixedAngle?:number,excludedEstimationBoxes:PdfBox[]=[]):{canvas:PdfCanvas;imageToPdf:PdfAffine;angle:number}{
  if(fixedAngle!==undefined&&(!Number.isFinite(fixedAngle)||Math.abs(fixedAngle)>3*Math.PI/180))throw new Error("INVALID_DESKEW_ANGLE");
  let bestAngle=fixedAngle??0;
  if(fixedAngle===undefined){
  const ctx=context2d(source),sampleStep=Math.max(2,Math.ceil(Math.max(source.width,source.height)/700));const pixels=ctx.getImageData(0,0,source.width,source.height).data;const points:Array<[number,number]>=[];
  // This is a copied estimation buffer. Do not erase original native widgets,
  // vector content, OCR input, rendered pixels or source PDF bytes.
  for(const box of excludedEstimationBoxes){if(!box.every(Number.isFinite))throw new Error("INVALID_DESKEW_MASK");for(let y=Math.max(0,Math.floor(box[1]-3));y<Math.min(source.height,Math.ceil(box[3]+3));y++)for(let x=Math.max(0,Math.floor(box[0]-3));x<Math.min(source.width,Math.ceil(box[2]+3));x++){const i=(y*source.width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=pixels[i+3]=255;}}
  for(let y=0;y<source.height;y+=sampleStep)for(let x=0;x<source.width;x+=sampleStep){const i=(y*source.width+x)*4;if(pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114<120)points.push([x-source.width/2,y-source.height/2]);}
  if(points.length<100)return {canvas:source,imageToPdf,angle:0};
  let bestScore=0,zeroScore=0;for(let degrees=-3;degrees<=3;degrees+=.5){const angle=degrees*Math.PI/180,s=Math.sin(angle),c=Math.cos(angle),bins=new Map<number,number>();for(const [x,y]of points){const bin=Math.round((x*s+y*c)/sampleStep);bins.set(bin,(bins.get(bin)??0)+1);}let score=0;for(const count of bins.values())score+=count*count;if(degrees===0)zeroScore=score;if(score>bestScore){bestScore=score;bestAngle=angle;}}
  bestAngle=refineAnalysisSkew(pixels,source.width,source.height,bestScore>=zeroScore*1.08?bestAngle:0);
  }
  if(Math.abs(bestAngle)<.002)return {canvas:source,imageToPdf,angle:0};
  const corrected=createCanvas(source.width,source.height),target=context2d(corrected);const c=Math.cos(bestAngle),s=Math.sin(bestAngle),cx=source.width/2,cy=source.height/2;const transform:PdfAffine=[c,s,-s,c,cx-c*cx+s*cy,cy-s*cx-c*cy];target.fillStyle="white";target.fillRect(0,0,source.width,source.height);target.setTransform(...transform);target.drawImage(source as CanvasImageSource,0,0);
  return {canvas:corrected,imageToPdf:multiply(imageToPdf,inverse(transform)),angle:bestAngle};
}
