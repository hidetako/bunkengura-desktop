// preload が公開する API の形。メイン側(実装)とレンダラ側(利用)の両方がここを参照する。
import type { BookMeta, DictionaryResult, Marker, Settings, TransMemo, VocabEntry } from './types';

export interface BunkenguraApi {
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Pick<Settings, 'model' | 'medicalMode'>>): Promise<Settings>;
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
}
