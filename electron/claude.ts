// Claude 呼び出し。メインプロセス(Node)で動かすので、APIキーは画面側に出ず CORS も関係ない。
import Anthropic from '@anthropic-ai/sdk';
import type { DictionaryResult } from '../shared/types';

let cached: { key: string; client: Anthropic } | null = null;

function clientFor(apiKey: string): Anthropic {
  if (cached && cached.key === apiKey) return cached.client;
  const client = new Anthropic({ apiKey });
  cached = { key: apiKey, client };
  return client;
}

/** 例外をそのまま画面に出すと分かりにくいので、日本語の対処可能な文言にする。 */
function toJapaneseError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error('APIキーが正しくありません。設定画面で入力し直してください。');
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new Error('このAPIキーでは利用が許可されていません。Anthropic コンソールで権限をご確認ください。');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Error('呼び出しが混み合っています。少し待ってからもう一度お試しください。');
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new Error(`リクエストが受け付けられませんでした: ${e.message}`);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new Error('Anthropic に接続できませんでした。ネットワーク接続をご確認ください。');
  }
  if (e instanceof Anthropic.APIError) {
    return new Error(`APIエラー (${e.status}): ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** 応答から本文テキストだけを連結して取り出す（thinking ブロックは混ぜない）。 */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** ```json ... ``` で包まれていても拾えるようにしてから JSON として読む。 */
function parseJsonLoose(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AIの応答を解釈できませんでした');
  return JSON.parse(body.slice(start, end + 1));
}

async function ask(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  effort: 'low' | 'medium' | 'high',
  maxTokens: number,
): Promise<string> {
  try {
    const res = await clientFor(apiKey).messages.create({
      model,
      max_tokens: maxTokens,
      system,
      // thinking は既定で有効なため指定しない。深さは effort で調整する。
      output_config: { effort },
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') {
      throw new Error('この内容には回答できないと判断されました。文章を変えてお試しください。');
    }
    const text = textOf(res.content);
    if (!text) throw new Error('AIから空の応答が返りました。もう一度お試しください。');
    return text;
  } catch (e) {
    throw toJapaneseError(e);
  }
}

const DICT_SYSTEM = (medical: boolean) => `あなたは英和辞典です。与えられた語について、以下のJSONだけを返します。
前置き・説明・コードフェンスは一切書かないでください。

{
  "word": "見出し語",
  "base_form": "入力が活用形・派生形のときだけ原形と変化の種類。原形ならば空文字",
  "context_usage": "文脈が与えられたとき、その文中での品詞と意味。文脈が無ければ空文字",
  "pronunciation": "発音記号（IPA）",
  "general_meaning": "一般的な意味。日本語で簡潔に",
  "medical_meaning": "${medical ? '医学・医療分野での意味。無ければ空文字' : '専門分野での意味。無ければ空文字'}",
  "example": "英語の例文1つと、その日本語訳"
}`;

export async function dictionaryLookup(
  apiKey: string,
  model: string,
  word: string,
  context: string,
  medicalMode: boolean,
): Promise<DictionaryResult> {
  const user = context
    ? `語: ${word}\n\nこの語が使われている文:\n${context}`
    : `語: ${word}`;
  // 辞書引きは単純な作業なので effort は low。thinking の分も含めて max_tokens に余裕を持たせる。
  const raw = await ask(apiKey, model, DICT_SYSTEM(medicalMode), user, 'low', 8000);
  const j = parseJsonLoose(raw);
  return {
    word: String(j.word ?? word),
    base_form: String(j.base_form ?? ''),
    context_usage: String(j.context_usage ?? ''),
    pronunciation: String(j.pronunciation ?? ''),
    general_meaning: String(j.general_meaning ?? ''),
    medical_meaning: String(j.medical_meaning ?? ''),
    example: String(j.example ?? ''),
  };
}

const TRANSLATE_SYSTEM = (medical: boolean) => `あなたは${medical ? '医学文献' : '専門文書'}の翻訳者です。
渡された文章を自然な日本語に翻訳します。

ルール:
- 訳文だけを返す。前置き・注釈・原文の再掲は書かない。
- 原文の段落構成を保つ。
- 専門用語は定訳を使い、初出の語は「訳語（原語）」の形にしてよい。`;

export async function translateText(
  apiKey: string,
  model: string,
  text: string,
  medicalMode: boolean,
): Promise<string> {
  return ask(apiKey, model, TRANSLATE_SYSTEM(medicalMode), text, 'medium', 16000);
}
