import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store';
import { dictionaryLookup, translateText } from './claude';
import { extractPdfText, guessKind } from './pdf';
import { assemble, looksLikeImagePdf, transcribePages } from './ocr';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  updatesSupported,
} from './updater';
import type { BookMeta, Marker, TransMemo, VocabEntry } from '../shared/types';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

let mainWindow: BrowserWindow | null = null;
const getWin = () => mainWindow;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#f4f5f7',
    title: '文献蔵',
    webPreferences: {
      preload: path.join(dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => win.show());

  // 外部リンクは既定のブラウザへ逃がす（アプリ内を乗っ取られないように）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(dirname, '../renderer/index.html'));
  }
}

// ===== IPC =====
// レンダラは preload 経由でのみここを呼ぶ。APIキーの実体は決して返さない。

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...(args as T)));
}

async function requireKey(): Promise<{ key: string; model: string; medicalMode: boolean }> {
  const key = await store.getApiKey();
  if (!key) throw new Error('APIキーが未設定です。画面右上の「設定」から入力してください。');
  const s = await store.getSettings();
  return { key, model: s.model, medicalMode: s.medicalMode };
}

function register() {
  // --- 設定 ---
  handle('settings:get', () => store.getSettings());
  handle('settings:update', (patch: any) => store.updateSettings(patch));
  handle('settings:setApiKey', (key: string) => store.setApiKey(key));
  handle('settings:clearApiKey', () => store.clearApiKey());
  handle('settings:encryptionAvailable', () => store.isEncryptionAvailable());

  // --- 蔵書 ---
  handle('books:list', () => store.listBooks());
  handle('books:text', (id: string) => store.readBookText(id));

  handle('books:pickAndImport', async () => {
    const r = await dialog.showOpenDialog({
      title: 'PDFを選ぶ',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (r.canceled || r.filePaths.length === 0) return [];

    const books = await store.listBooks();
    const added: BookMeta[] = [];
    for (const p of r.filePaths) {
      const buf = await fs.readFile(p);
      const { title, text, pages } = await extractPdfText(new Uint8Array(buf));
      const id = uid();
      await store.writeBookFiles(id, text, buf);
      const kind = guessKind(text);
      const imageOnly = looksLikeImagePdf(text, pages);
      const meta: BookMeta = {
        id,
        title: title || path.basename(p, path.extname(p)),
        author: '',
        filename: path.basename(p),
        pages,
        kind,
        created_at: nowIso(),
        updated_at: nowIso(),
        last_page: 0,
        // テキスト層がほぼ無ければ、本文は未取得として書き起こしを促す
        source: imageOnly ? 'none' : 'pdf',
        // 和書は縦書きが普通なので既定にする（画面でいつでも切り替えられる）
        vertical: kind === '和書',
        continuous: false,
      };
      books.unshift(meta);
      added.push(meta);
    }
    await store.saveBooks(books);
    return added;
  });

  handle('books:update', async (id: string, patch: Partial<BookMeta>) => {
    const books = await store.listBooks();
    const i = books.findIndex((b) => b.id === id);
    if (i < 0) throw new Error('その本は見つかりませんでした');
    books[i] = { ...books[i], ...patch, id, updated_at: nowIso() };
    await store.saveBooks(books);
    return books[i];
  });

  handle('books:delete', async (id: string) => {
    await store.saveBooks((await store.listBooks()).filter((b) => b.id !== id));
    // 本を消したら、その本に紐づく書き込みも一緒に片付ける
    await store.saveMemos((await store.listMemos()).filter((m) => m.book_id !== id));
    await store.saveMarkers((await store.listMarkers()).filter((m) => m.book_id !== id));
    await store.removeBookFiles(id);
    return true;
  });

  handle('books:openPdf', async (id: string) => {
    const err = await shell.openPath(store.bookPdfPath(id));
    if (err) throw new Error(`PDFを開けませんでした: ${err}`);
    return true;
  });

  // --- 単語帳 ---
  handle('vocab:list', () => store.listVocab());
  handle('vocab:add', async (entry: Omit<VocabEntry, 'id' | 'created_at'>) => {
    const list = await store.listVocab();
    const v: VocabEntry = { ...entry, id: uid(), created_at: nowIso() };
    list.unshift(v);
    await store.saveVocab(list);
    return v;
  });
  handle('vocab:delete', async (id: string) => {
    await store.saveVocab((await store.listVocab()).filter((v) => v.id !== id));
    return true;
  });

  // --- 対訳メモ ---
  handle('memos:list', () => store.listMemos());
  handle('memos:add', async (m: Omit<TransMemo, 'id' | 'created_at' | 'updated_at'>) => {
    const list = await store.listMemos();
    const memo: TransMemo = { ...m, id: uid(), created_at: nowIso(), updated_at: nowIso() };
    list.unshift(memo);
    await store.saveMemos(list);
    return memo;
  });
  handle('memos:update', async (id: string, patch: Partial<TransMemo>) => {
    const list = await store.listMemos();
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) throw new Error('その対訳メモは見つかりませんでした');
    list[i] = { ...list[i], ...patch, id, updated_at: nowIso() };
    await store.saveMemos(list);
    return list[i];
  });
  handle('memos:delete', async (id: string) => {
    await store.saveMemos((await store.listMemos()).filter((m) => m.id !== id));
    return true;
  });

  // --- マーカー ---
  handle('markers:list', () => store.listMarkers());
  handle('markers:add', async (m: Omit<Marker, 'id' | 'created_at'>) => {
    const list = await store.listMarkers();
    const mk: Marker = { ...m, id: uid(), created_at: nowIso() };
    list.unshift(mk);
    await store.saveMarkers(list);
    return mk;
  });
  handle('markers:delete', async (id: string) => {
    await store.saveMarkers((await store.listMarkers()).filter((m) => m.id !== id));
    return true;
  });

  // --- 書き起こし（画像PDF） ---
  handle('books:pdfBytes', async (id: string) => (await store.readBookPdf(id)).toString('base64'));

  handle('ocr:pages', async (model: string, pages: { page: number; png: string }[]) => {
    const key = await store.getApiKey();
    if (!key) throw new Error('APIキーが未設定です。設定画面で入力してください。');
    const map = await transcribePages(key, model, pages, () => false, () => undefined);
    return [...map.entries()].map(([page, text]) => ({ page, text }));
  });

  handle('ocr:commit', async (bookId: string, text: string) => {
    await store.writeBookText(bookId, text);
    const books = await store.listBooks();
    const i = books.findIndex((b) => b.id === bookId);
    if (i < 0) throw new Error('その本は見つかりませんでした');
    const kind = guessKind(text);
    books[i] = {
      ...books[i],
      kind,
      vertical: kind === '和書',
      source: 'ocr',
      updated_at: nowIso(),
    };
    await store.saveBooks(books);
    return books[i];
  });

  // --- AI ---
  handle('ai:dictionary', async (word: string, context: string) => {
    const { key, model, medicalMode } = await requireKey();
    return dictionaryLookup(key, model, word, context, medicalMode);
  });
  handle('ai:translate', async (text: string) => {
    const { key, model, medicalMode } = await requireKey();
    return translateText(key, model, text, medicalMode);
  });

  // --- 更新 ---
  handle('update:state', () => getUpdateState());
  handle('update:check', () => checkForUpdates(getWin, true));
  handle('update:download', () => downloadUpdate(getWin));
  handle('update:install', () => {
    installUpdate();
    return true;
  });

  // --- その他 ---
  handle('app:version', () => app.getVersion());
  handle('app:openExternal', async (url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error('開けないURLです');
    await shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(async () => {
  register();
  createWindow();

  // 起動時の更新確認。設定で切れるようにしてある。
  // 画面が出てから少し置いて走らせ、起動の体感を邪魔しない。
  if (updatesSupported()) {
    const s = await store.getSettings();
    if (s.checkUpdates) setTimeout(() => void checkForUpdates(getWin, false), 3000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
