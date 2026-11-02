// 保存層。クラウドは使わず、OSのユーザーデータ領域に JSON とファイルで置く。
//   <userData>/library.json          … 蔵書の目録
//   <userData>/books/<id>.txt        … 抽出した本文
//   <userData>/books/<id>.pdf        … 取り込んだPDFの実体
//   <userData>/vocabulary.json       … 単語帳
//   <userData>/translation-memos.json… 対訳メモ
//   <userData>/markers.json          … マーカー
//   <userData>/settings.json         … 設定（APIキーは暗号化して別枠で保持）
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BookMeta, Marker, Settings, TransMemo, VocabEntry } from '../shared/types';
import { DEFAULT_MODEL, DEFAULT_OCR_MODEL } from '../shared/types';

const root = () => app.getPath('userData');
const booksDir = () => path.join(root(), 'books');
const file = (name: string) => path.join(root(), name);

async function ensureDirs() {
  await fs.mkdir(booksDir(), { recursive: true });
}

// JSON の読み書き。壊れたファイルで起動できなくならないよう、読めなければ既定値に戻す。
async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file(name), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await ensureDirs();
  // 書き込み途中で落ちても元ファイルを壊さないよう、一時ファイル経由で置き換える
  const tmp = file(name + '.tmp');
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file(name));
}

// ===== 蔵書 =====
export const listBooks = () => readJson<BookMeta[]>('library.json', []);
export const saveBooks = (b: BookMeta[]) => writeJson('library.json', b);

export const bookTextPath = (id: string) => path.join(booksDir(), `${id}.txt`);
export const bookPdfPath = (id: string) => path.join(booksDir(), `${id}.pdf`);

export async function readBookText(id: string): Promise<string> {
  try {
    return await fs.readFile(bookTextPath(id), 'utf8');
  } catch {
    return '';
  }
}

export async function readBookPdf(id: string): Promise<Buffer> {
  return fs.readFile(bookPdfPath(id));
}

export async function writeBookText(id: string, text: string): Promise<void> {
  await ensureDirs();
  await fs.writeFile(bookTextPath(id), text, 'utf8');
}

export async function writeBookFiles(id: string, text: string, pdf: Buffer): Promise<void> {
  await ensureDirs();
  await fs.writeFile(bookTextPath(id), text, 'utf8');
  await fs.writeFile(bookPdfPath(id), pdf);
}

export async function removeBookFiles(id: string): Promise<void> {
  await fs.rm(bookTextPath(id), { force: true });
  await fs.rm(bookPdfPath(id), { force: true });
}

// ===== 単語帳・対訳メモ・マーカー =====
export const listVocab = () => readJson<VocabEntry[]>('vocabulary.json', []);
export const saveVocab = (v: VocabEntry[]) => writeJson('vocabulary.json', v);
export const listMemos = () => readJson<TransMemo[]>('translation-memos.json', []);
export const saveMemos = (m: TransMemo[]) => writeJson('translation-memos.json', m);
export const listMarkers = () => readJson<Marker[]>('markers.json', []);
export const saveMarkers = (m: Marker[]) => writeJson('markers.json', m);

// ===== 設定 =====
interface StoredSettings {
  model: string;
  ocrModel: string;
  medicalMode: boolean;
  checkUpdates?: boolean;
  /** safeStorage で暗号化した APIキー（base64）。OSの鍵束に紐づくため他端末では復号できない */
  apiKeyEnc?: string;
  /** 暗号化が使えない環境でのみ使う平文の退避先 */
  apiKeyPlain?: string;
}

const defaults: StoredSettings = {
  model: DEFAULT_MODEL,
  ocrModel: DEFAULT_OCR_MODEL,
  medicalMode: true,
  checkUpdates: true,
};

const readSettings = () => readJson<StoredSettings>('settings.json', defaults);

export async function getSettings(): Promise<Settings> {
  const s = await readSettings();
  return {
    hasApiKey: Boolean(s.apiKeyEnc || s.apiKeyPlain),
    model: s.model || DEFAULT_MODEL,
    ocrModel: s.ocrModel || DEFAULT_OCR_MODEL,
    medicalMode: s.medicalMode ?? true,
    checkUpdates: s.checkUpdates ?? true,
  };
}

export async function updateSettings(
  patch: Partial<Pick<Settings, 'model' | 'ocrModel' | 'medicalMode' | 'checkUpdates'>>,
): Promise<Settings> {
  const s = await readSettings();
  await writeJson('settings.json', { ...s, ...patch });
  return getSettings();
}

export async function setApiKey(key: string): Promise<Settings> {
  const s = await readSettings();
  const trimmed = key.trim();
  if (!trimmed) return clearApiKey();
  if (safeStorage.isEncryptionAvailable()) {
    await writeJson('settings.json', {
      ...s,
      apiKeyEnc: safeStorage.encryptString(trimmed).toString('base64'),
      apiKeyPlain: undefined,
    });
  } else {
    // Linux で鍵束が無い等、暗号化が使えない場合。保存はするが画面側で注意を出す。
    await writeJson('settings.json', { ...s, apiKeyPlain: trimmed, apiKeyEnc: undefined });
  }
  return getSettings();
}

export async function clearApiKey(): Promise<Settings> {
  const s = await readSettings();
  await writeJson('settings.json', { ...s, apiKeyEnc: undefined, apiKeyPlain: undefined });
  return getSettings();
}

/** 実際のキーを取り出す。メインプロセス内でのみ使い、レンダラへは絶対に返さない。 */
export async function getApiKey(): Promise<string> {
  const s = await readSettings();
  if (s.apiKeyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
    } catch {
      // 別端末のプロファイルを持ち込んだ等で復号できない
      return '';
    }
  }
  return s.apiKeyPlain ?? '';
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
