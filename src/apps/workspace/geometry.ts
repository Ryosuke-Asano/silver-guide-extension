import type { PdfBox, PdfPageInfo, PdfPoint, PdfQuad } from "../../domain/pdf";

export function pointToScreen(point: PdfPoint, page: PdfPageInfo): PdfPoint {
  const [x0, y0, x1, y1] = page.visibleBox;
  const x = (point.x - x0) / (x1 - x0);
  const y = (point.y - y0) / (y1 - y0);
  switch (page.rotation) {
    case 90: return { x: y, y: x };
    case 180: return { x: 1 - x, y };
    case 270: return { x: 1 - y, y: 1 - x };
    default: return { x, y: 1 - y };
  }
}

export function screenToPoint(point: PdfPoint, page: PdfPageInfo): PdfPoint {
  const [x0, y0, x1, y1] = page.visibleBox;
  let x = point.x;
  let y = 1 - point.y;
  if (page.rotation === 90) { x = point.y; y = point.x; }
  if (page.rotation === 180) { x = 1 - point.x; y = point.y; }
  if (page.rotation === 270) { x = 1 - point.y; y = 1 - point.x; }
  return { x: x0 + x * (x1 - x0), y: y0 + y * (y1 - y0) };
}

export function quadToScreenBox(quad: PdfQuad, page: PdfPageInfo): PdfBox {
  const points = quad.map(point => pointToScreen(point, page));
  return [Math.min(...points.map(point => point.x)), Math.min(...points.map(point => point.y)), Math.max(...points.map(point => point.x)), Math.max(...points.map(point => point.y))];
}
