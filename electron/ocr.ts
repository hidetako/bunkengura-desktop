// 画像PDF（スキャン）の書き起こし。ページ画像を Claude に直接読ませる。
//
// Web版は「Google Vision で読む → 別途 Claude でルビを剥がす」の2段構えだったが、
// 後処理でルビを剥がすのは取りこぼしが出やすい。ここでは最初から
// 「ルビは本文ではないので書かない」と指示して書き起こすため、汚染が起きにくい。
// 縦書きもそのまま読めるので、和書の扱いが素直になる。
import Anthropic from '@anthropic-ai/sdk';
import { toJapaneseError } from './anthropic-errors';

export interface OcrPageInput {
  /** 1始まりのページ番号 */
  page: number;
  /** PNG の base64（データURLのヘッダは含まない） */
  png: string;
}

const SYSTEM = `あなたは日本語と英語の書籍ページを文字に起こす専門家です。
渡されたページ画像から、本文だけを取り出してテキストにします。

守ること:
- **ルビ（振り仮名）は本文ではありません。絶対に書き起こさないでください。**
  漢字の脇や上に小さく添えられた仮名は、すべて無視します。
  例: 「口髭(くちひげ)」と見えたら「口髭」とだけ書く。「くちひげ」は書かない。
- 縦書きのページは、右の行から左の行へ読む順に書きます。
- 柱（ページ上部の章名）・ノンブル（ページ番号）・奥付の飾りは書きません。
- 図表の中の文字は、本文の流れに関係するものだけ書きます。
- 原文の改行と段落を保ちます。旧字体・旧仮名は原文のまま写します。
- 読み取れない文字は □ に置き換えます。推測で補わないでください。
- **本文以外は一切書かないでください。** 前置き・注釈・「このページには〜」といった
  説明・コードフェンスは禁止です。本文が無い（白紙・図版のみ）ページは、
  何も書かずに空で返してください。`;

export class OcrCanceled extends Error {
  constructor() {
    super('書き起こしを中止しました');
  }
}

/** 1ページぶんを書き起こす。 */
async function transcribePage(
  client: Anthropic,
  model: string,
  input: OcrPageInput,
): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    // 書き起こしは判断の要らない作業なので effort は low に寄せる
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.png } },
          { type: 'text', text: 'このページの本文を書き起こしてください。ルビは書かないこと。' },
        ],
      },
    ],
  });
  if (res.stop_reason === 'refusal') return '';
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * ページ画像の配列を順に書き起こす。
 * @param shouldCancel 中止が押されたかを毎ページ確認する
 * @param onPage 1ページ終わるたびに呼ばれる
 */
export async function transcribePages(
  apiKey: string,
  model: string,
  pages: OcrPageInput[],
  shouldCancel: () => boolean,
  onPage: (done: number, total: number, sample: string) => void,
): Promise<Map<number, string>> {
  const client = new Anthropic({ apiKey });
  const out = new Map<number, string>();
  // 速さと行儀のつり合い。多くしすぎるとレート制限に当たる。
  const CONCURRENCY = 4;
  let cursor = 0;
  let done = 0;
  let failure: Error | null = null;

  const worker = async () => {
    for (;;) {
      if (failure || shouldCancel()) return;
      const i = cursor++;
      if (i >= pages.length) return;
      const p = pages[i];
      try {
        const text = await transcribePage(client, model, p);
        out.set(p.page, text);
        done++;
        onPage(done, pages.length, text.slice(0, 60));
      } catch (e) {
        // 1ページの失敗で全部を捨てない。空のまま進め、最後に件数で知らせる。
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          failure = e as Error;
          return;
        }
        out.set(p.page, '');
        done++;
        onPage(done, pages.length, '（このページは読み取れませんでした）');
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
  if (failure) throw toJapaneseError(failure);
  if (shouldCancel()) throw new OcrCanceled();
  return out;
}

/** 書き起こし結果を {{PAGE n}} 区切りの本文に組み立てる。 */
export function assemble(map: Map<number, string>): string {
  return [...map.keys()]
    .sort((a, b) => a - b)
    .map((n) => `{{PAGE ${n}}}\n${map.get(n) ?? ''}`)
    .join('\n\n');
}

/** テキスト層がほぼ無い＝画像PDFとみなす判定。 */
export function looksLikeImagePdf(text: string, pages: number): boolean {
  const body = text.replace(/\{\{PAGE\s+\d+\}\}/g, '').replace(/\s+/g, '');
  // 1ページあたり20文字に満たないなら、文字情報を持たないPDFと考える
  return pages > 0 && body.length < pages * 20;
}
