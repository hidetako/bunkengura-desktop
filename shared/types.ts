// レンダラとメインプロセスで共有する型。IPC の境界を型で固定する。

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  filename: string;
  pages: number;
  kind: '和書' | '洋書';
  created_at: string;
  updated_at: string;
  /** 最後に読んでいたページ（1始まり。0は未読） */
  last_page: number;
  /** どうやって本文を得たか。'pdf'=テキスト層 / 'ocr'=画像から書き起こし / 'none'=未取得 */
  source: 'pdf' | 'ocr' | 'none';
  /** 縦書きで表示する（和書の既定） */
  vertical: boolean;
  /** ページ送りではなく連続スクロールで読む */
  continuous: boolean;
}

export interface VocabEntry {
  id: string;
  word: string;
  pronunciation: string;
  general_meaning: string;
  medical_meaning: string;
  example: string;
  source_sentence: string;
  source_book_id: string;
  source_title: string;
  created_at: string;
}

export interface TransMemo {
  id: string;
  book_id: string;
  source_title: string;
  text: string;
  translation: string;
  memo: string;
  /** 本文中での位置特定用（同一文字列が複数あるときに正しい出現を選ぶ） */
  prefix: string;
  suffix: string;
  approx_offset: number;
  page: number;
  created_at: string;
  updated_at: string;
}

export type MarkerColor = 'red' | 'yellow' | 'blue';
export type MarkerStyle = 'marker' | 'underline';

export interface Marker {
  id: string;
  book_id: string;
  text: string;
  color: MarkerColor;
  style: MarkerStyle;
  prefix: string;
  suffix: string;
  approx_offset: number;
  page: number;
  created_at: string;
}

export interface DictionaryResult {
  word: string;
  base_form: string;
  context_usage: string;
  pronunciation: string;
  general_meaning: string;
  medical_meaning: string;
  example: string;
}

/** 設定。APIキー本体は含めない（OSの暗号化領域に置き、有無だけを返す） */
export interface Settings {
  hasApiKey: boolean;
  /** 辞書・翻訳に使うモデル */
  model: string;
  /** 画像PDFの書き起こしに使うモデル。ページ数ぶん呼ぶので別に選べるようにする */
  ocrModel: string;
  /** 辞書・翻訳で医学寄りの語義を優先するか */
  medicalMode: boolean;
  /** 起動時に新しい版が出ていないか確かめる */
  checkUpdates: boolean;
}

/** 更新の状態。メインプロセスから画面へ随時送る。 */
export interface UpdateState {
  phase:
    | 'idle'         // まだ確認していない
    | 'checking'     // 確認中
    | 'none'         // 最新だった
    | 'available'    // 新しい版がある（まだ落としていない）
    | 'downloading'  // 取得中
    | 'ready'        // 取得済み。再起動すれば当たる
    | 'error'
    | 'unsupported'; // 開発中の実行など、更新を扱えない状況
  version: string;
  percent?: number;
  error?: string;
}

/** 書き起こしの進み具合。メインプロセスから随時送る。 */
export interface OcrProgress {
  bookId: string;
  done: number;
  total: number;
  /** 直近に読み終えたページの冒頭（様子が見えるように） */
  sample: string;
  state: 'running' | 'done' | 'error' | 'canceled';
  error?: string;
}

/** 書き起こし前に見せる見積もり。 */
export interface OcrEstimate {
  pages: number;
  model: string;
  /** 米ドル */
  usd: number;
  /** 円（概算。為替は固定値なので目安） */
  jpy: number;
}

/** 1Mトークンあたりの単価（米ドル）。見積もり計算に使う。 */
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
};

export const MODEL_OPTIONS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5（最も賢い）', note: '入力 $4 / 出力 $20 per 1M' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5（速さと賢さの両立）', note: '入力 $2 / 出力 $10 per 1M' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5（最も速い・安い）', note: '入力 $0.10 / 出力 $0.50 per 1M' },
] as const;

/** 書き起こし1ページあたりのトークン見込み。
 *  入力は Claude が長辺1568pxに縮めた画像のトークン数（幅×高さ÷750）の実測寄りの値。
 *  出力は和書1ページぶんの日本語テキストの目安。 */
export const OCR_TOKENS_PER_PAGE = { in: 2300, out: 800 };

export function estimateOcrCost(pages: number, model: string): OcrEstimate {
  const p = PRICING[model] ?? PRICING['claude-sonnet-5-5'];
  const usd =
    (pages * OCR_TOKENS_PER_PAGE.in * p.in) / 1_000_000 +
    (pages * OCR_TOKENS_PER_PAGE.out * p.out) / 1_000_000;
  return { pages, model, usd, jpy: usd * 150 };
}

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_OCR_MODEL = 'claude-sonnet-5-5';
