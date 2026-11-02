// preload が公開する API の形。メイン側(実装)とレンダラ側(利用)の両方がここを参照する。
import type {
  BookMeta,
  DictionaryResult,
  Marker,
  Settings,
  TransMemo,
  UpdateState,
  VocabEntry,
} from './types';

export interface BunkenguraApi {
  settings: {
    get(): Promise<Settings>;
    update(
      patch: Partial<Pick<Settings, 'model' | 'ocrModel' | 'medicalMode' | 'checkUpdates'>>,
    ): Promise<Settings>;
    setApiKey(key: string): Promise<Settings>;
    clearApiKey(): Promise<Settings>;
    encryptionAvailable(): Promise<boolean>;
  };
  books: {
    list(): Promise<BookMeta[]>;
    text(id: string): Promise<string>;
    pickAndImport(): Promise<BookMeta[]>;
    update(id: string, patch: Partial<BookMeta>): Promise<BookMeta>;
    remove(id: string): Promise<boolean>;
    openPdf(id: string): Promise<boolean>;
    /** PDFの実体を base64 で受け取る（画面側でページを画像に起こすため） */
    pdfBytes(id: string): Promise<string>;
  };
  ocr: {
    /** ページ画像を書き起こす。1回の呼び出しで数ページぶんまとめて渡す。 */
    pages(model: string, pages: { page: number; png: string }[]): Promise<{ page: number; text: string }[]>;
    /** 書き起こした本文を保存して、本の情報を更新する */
    commit(bookId: string, text: string): Promise<BookMeta>;
  };
  vocab: {
    list(): Promise<VocabEntry[]>;
    add(e: Omit<VocabEntry, 'id' | 'created_at'>): Promise<VocabEntry>;
    remove(id: string): Promise<boolean>;
  };
  memos: {
    list(): Promise<TransMemo[]>;
    add(m: Omit<TransMemo, 'id' | 'created_at' | 'updated_at'>): Promise<TransMemo>;
    update(id: string, patch: Partial<TransMemo>): Promise<TransMemo>;
    remove(id: string): Promise<boolean>;
  };
  markers: {
    list(): Promise<Marker[]>;
    add(m: Omit<Marker, 'id' | 'created_at'>): Promise<Marker>;
    remove(id: string): Promise<boolean>;
  };
  ai: {
    dictionary(word: string, context: string): Promise<DictionaryResult>;
    translate(text: string): Promise<string>;
  };
  app: {
    version(): Promise<string>;
    openExternal(url: string): Promise<boolean>;
  };
  update: {
    /** いまの状態を取り出す（画面を開き直したときの復帰用） */
    state(): Promise<UpdateState>;
    /** 新しい版が出ていないか確かめる */
    check(): Promise<UpdateState>;
    /** 新しい版を取得する */
    download(): Promise<void>;
    /** 取得済みの更新を当てて再起動する */
    install(): Promise<void>;
    /** 状態が変わるたびに呼ばれる。戻り値を呼ぶと購読をやめる */
    onState(cb: (s: UpdateState) => void): () => void;
  };
}
