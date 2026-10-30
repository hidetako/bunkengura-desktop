// preload が公開した API を型付きで受け取る。ここ以外から window を直接触らない。
import type { BunkenguraApi } from '@shared/api';

declare global {
  interface Window {
    bunkengura: BunkenguraApi;
  }
}

export const api = window.bunkengura;

/** 例外を握りつぶさずに、画面に出せる文言へ揃える。 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
