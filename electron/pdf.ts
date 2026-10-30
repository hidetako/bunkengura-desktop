// PDFからテキスト層を取り出す。描画はしないので worker も canvas も要らない。
// pdfjs-dist の legacy ビルドは CMap 設定なしで日本語（CIDフォント）も取り出せる。
export interface ExtractResult {
  title: string;
  /** {{PAGE n}} 区切りを挟んだ全文 */
  text: string;
  pages: number;
}

export async function extractPdfText(data: Uint8Array): Promise<ExtractResult> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: number = doc.numPages;

  const parts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // items を素直に連結する。pdfjs は行送りを hasEOL で教えてくれる。
    let body = '';
    for (const item of content.items as any[]) {
      if (typeof item.str !== 'string') continue;
      body += item.str;
      if (item.hasEOL) body += '\n';
    }
    parts.push(`{{PAGE ${i}}}\n${body.trim()}`);
    page.cleanup();
  }

  let title = '';
  try {
    const meta = await doc.getMetadata();
    title = String((meta?.info as any)?.Title ?? '').trim();
  } catch {
    /* メタデータが無いPDFは珍しくない */
  }
  await doc.destroy();

  return { title, text: parts.join('\n\n'), pages };
}

/** 和書か洋書かを本文の冒頭から推定する（リーダーの既定の組み方に使う） */
export function guessKind(text: string): '和書' | '洋書' {
  const head = text.slice(0, 4000);
  const jp = head.match(/[ぁ-んァ-ヶ一-龠]/g)?.length ?? 0;
  return jp >= 20 ? '和書' : '洋書';
}
