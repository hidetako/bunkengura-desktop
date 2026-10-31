// PDFのページを画像に起こす。Claude に読ませるための下ごしらえ。
// 画面側（Chromium）で行う。canvas が使えるので追加の native 依存が要らない。
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Claude は長辺1568pxに縮めてから読むので、それ以上大きく描いても費用が増えるだけ。
const LONG_EDGE = 1568;

export interface RasterPage {
  page: number;
  png: string; // base64（データURLのヘッダ抜き）
}

export async function openPdf(data: Uint8Array) {
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/** 指定ページを1枚だけ画像にする。 */
export async function rasterizePage(doc: any, pageNo: number): Promise<RasterPage> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = LONG_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // 紙の白を敷く。透過のままだと黒地になって読めなくなる。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();

  const png = canvas.toDataURL('image/png').split(',')[1];
  // 大きな canvas を抱えたままにしない
  canvas.width = 0;
  canvas.height = 0;
  return { page: pageNo, png };
}
