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
  model: string;
  /** 辞書・翻訳で医学寄りの語義を優先するか */
  medicalMode: boolean;
}

export interface ImportResult {
  book: BookMeta;
  /** テキスト層が無く本文を取り出せなかった場合に true */
  empty: boolean;
}

export const MODEL_OPTIONS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5（最も賢い・既定）', note: '入力 $4 / 出力 $20 per 1M' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5（速さと賢さの両立）', note: '入力 $2 / 出力 $10 per 1M' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5（最も速い・安い）', note: '入力 $0.10 / 出力 $0.50 per 1M' },
] as const;

export const DEFAULT_MODEL = 'claude-opus-5-5';
