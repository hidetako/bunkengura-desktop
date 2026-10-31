// preload が公開した API を型付きで受け取る。ここ以外から window を直接触らない。
import type { BunkenguraApi } from '@shared/api';

declare global {
  interface Window {
    bunkengura: BunkenguraApi;
  }
}

export const api = window.bunkengura;

/** 例外を握りつぶさずに、画面に出せる文言へ揃える。
 *  IPC を越えると "Error invoking remote method 'x': Error: 〜" が前に付くので、そこは落とす。 */
export function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim();
}
