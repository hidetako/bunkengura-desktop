// レンダラに渡す唯一の窓口。ここに無いものは画面側から触れない。
import { contextBridge, ipcRenderer } from 'electron';
import type { BookMeta, Marker, Settings, TransMemo, VocabEntry } from '../shared/types';
import type { BunkenguraApi } from '../shared/api';

const call = <R>(channel: string, ...args: unknown[]): Promise<R> =>
  ipcRenderer.invoke(channel, ...args) as Promise<R>;

const api: BunkenguraApi = {
  settings: {
    get: () => call<Settings>('settings:get'),
    update: (patch: Partial<Pick<Settings, 'model' | 'ocrModel' | 'medicalMode'>>) =>
      call<Settings>('settings:update', patch),
    setApiKey: (key: string) => call<Settings>('settings:setApiKey', key),
    clearApiKey: () => call<Settings>('settings:clearApiKey'),
    encryptionAvailable: () => call<boolean>('settings:encryptionAvailable'),
  },
  books: {
    list: () => call<BookMeta[]>('books:list'),
    text: (id: string) => call<string>('books:text', id),
    pickAndImport: () => call<BookMeta[]>('books:pickAndImport'),
    update: (id: string, patch: Partial<BookMeta>) => call<BookMeta>('books:update', id, patch),
    remove: (id: string) => call<boolean>('books:delete', id),
    openPdf: (id: string) => call<boolean>('books:openPdf', id),
    pdfBytes: (id: string) => call<string>('books:pdfBytes', id),
  },
  ocr: {
    pages: (model: string, pages: { page: number; png: string }[]) =>
      call<{ page: number; text: string }[]>('ocr:pages', model, pages),
    commit: (bookId: string, text: string) => call<BookMeta>('ocr:commit', bookId, text),
  },
  vocab: {
    list: () => call<VocabEntry[]>('vocab:list'),
    add: (e: Omit<VocabEntry, 'id' | 'created_at'>) => call<VocabEntry>('vocab:add', e),
    remove: (id: string) => call<boolean>('vocab:delete', id),
  },
  memos: {
    list: () => call<TransMemo[]>('memos:list'),
    add: (m: Omit<TransMemo, 'id' | 'created_at' | 'updated_at'>) => call<TransMemo>('memos:add', m),
    update: (id: string, patch: Partial<TransMemo>) => call<TransMemo>('memos:update', id, patch),
    remove: (id: string) => call<boolean>('memos:delete', id),
  },
  markers: {
    list: () => call<Marker[]>('markers:list'),
    add: (m: Omit<Marker, 'id' | 'created_at'>) => call<Marker>('markers:add', m),
    remove: (id: string) => call<boolean>('markers:delete', id),
  },
  ai: {
    dictionary: (word: string, context: string) =>
      call<import('../shared/types').DictionaryResult>('ai:dictionary', word, context),
    translate: (text: string) => call<string>('ai:translate', text),
  },
  app: {
    version: () => call<string>('app:version'),
    openExternal: (url: string) => call<boolean>('app:openExternal', url),
  },
};

contextBridge.exposeInMainWorld('bunkengura', api);
