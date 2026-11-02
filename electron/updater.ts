// 起動時の更新確認と適用。配り元は GitHub Releases（electron-builder.yml の publish）。
//
// 署名証明書を付けていないため、更新ファイルの署名照合は切る。
// 有効のままだと「署名が無い＝不正」とみなされ、更新が必ず失敗する。
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/types';

const { autoUpdater } = electronUpdater;

let current: UpdateState = { phase: 'idle', version: '' };
let wired = false;

function send(win: BrowserWindow | null, state: UpdateState) {
  current = state;
  if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
}

export function getUpdateState(): UpdateState {
  return current;
}

/** 更新の仕組みが使えるか。開発中や未梱包では動かせない。 */
export function updatesSupported(): boolean {
  return app.isPackaged;
}

function wire(getWin: () => BrowserWindow | null) {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = false; // 95MB を黙って落とさない。利用者に選ばせる
  autoUpdater.autoInstallOnAppQuit = true;
  // 署名していないので照合しない（上のコメント参照）
  (autoUpdater as any).verifyUpdateCodeSignature = false;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    send(getWin(), { phase: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    send(getWin(), { phase: 'none', version: app.getVersion() });
  });
  autoUpdater.on('download-progress', (p) => {
    send(getWin(), {
      phase: 'downloading',
      version: current.version,
      percent: Math.round(p.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send(getWin(), { phase: 'ready', version: info.version });
  });
  autoUpdater.on('error', (e) => {
    send(getWin(), {
      phase: 'error',
      version: current.version,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

/**
 * 更新を確かめる。
 * @param manual 利用者が「今すぐ確認」を押した場合。確認中であることを画面に出す
 */
export async function checkForUpdates(
  getWin: () => BrowserWindow | null,
  manual: boolean,
): Promise<UpdateState> {
  if (!updatesSupported()) {
    const s: UpdateState = {
      phase: 'unsupported',
      version: app.getVersion(),
      error: '開発中の実行では更新を確認できません。',
    };
    send(getWin(), s);
    return s;
  }
  wire(getWin);
  if (manual) send(getWin(), { phase: 'checking', version: app.getVersion() });
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    send(getWin(), {
      phase: 'error',
      version: app.getVersion(),
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return current;
}

export async function downloadUpdate(getWin: () => BrowserWindow | null): Promise<void> {
  if (!updatesSupported()) return;
  wire(getWin);
  send(getWin(), { phase: 'downloading', version: current.version, percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    send(getWin(), {
      phase: 'error',
      version: current.version,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 落とし終えた更新を当てて再起動する。 */
export function installUpdate(): void {
  if (!updatesSupported()) return;
  // 第1引数 isSilent=false: インストーラの画面を出す（無言インストールは不審に見えるため）
  // 第2引数 isForceRunAfter=true: 入れ終わったら自動で起動し直す
  autoUpdater.quitAndInstall(false, true);
}
