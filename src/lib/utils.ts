// 本文の位置合わせ・文脈抽出まわり。bunkengura-web から移植。
// PDF抽出のゆれ（合字・ハイフネーション・空白の差）があっても、
// 保存したマーカーや対訳メモを本文に再び当てられるようにするのが主目的。

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const nowIso = (): string => new Date().toISOString();

export function classNames(...a: Array<string | false | null | undefined>): string {
  return a.filter(Boolean).join(' ');
}


function normForMatch(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function findPositionInText(
  normText: string,
  rec: { text: string; prefix?: string; suffix?: string; approx_offset?: number },
): { start: number; end: number } | null {
  const t = normForMatch(rec.text);
  if (t.length < 2) return null;
  const hay = normText;
  const hits: number[] = [];
  for (let i = hay.indexOf(t); i >= 0; i = hay.indexOf(t, i + 1)) {
    hits.push(i);
    if (hits.length > 5000) break;
  }
  if (hits.length === 0) {
    // 全文一致しない場合のフォールバック：先頭チャンクで概略位置を特定し、
    // 元テキスト長ぶんを印付ける。PDF抽出の差異（合字・ハイフネーション・空白）や
    // 旧データのテキストずれでも、本文に印・ホバーが出るようにする。
    for (const len of [60, 40, 24]) {
      if (t.length < len) continue;
      const head = t.slice(0, len);
      let i = hay.indexOf(head);
      if (i < 0) continue;
      // 同じ先頭が複数あれば approx_offset に最も近い出現を選ぶ
      if (typeof rec.approx_offset === 'number') {
        const a = rec.approx_offset;
        for (let j = hay.indexOf(head, i + 1); j >= 0; j = hay.indexOf(head, j + 1)) {
          if (Math.abs(j - a) < Math.abs(i - a)) i = j;
        }
      }
      return { start: i, end: Math.min(hay.length, i + t.length) };
    }
    return null;
  }
  if (hits.length === 1) return { start: hits[0], end: hits[0] + t.length };

  const pre = rec.prefix ? normForMatch(rec.prefix) : '';
  const suf = rec.suffix ? normForMatch(rec.suffix) : '';
  // 1) prefix + suffix 両一致
  if (pre && suf) {
    const both = hits.find(
      (i) =>
        hay.slice(Math.max(0, i - pre.length), i) === pre &&
        hay.slice(i + t.length, i + t.length + suf.length) === suf,
    );
    if (both !== undefined) return { start: both, end: both + t.length };
  }
  // 2) approx_offset 近傍
  if (typeof rec.approx_offset === 'number') {
    const a = rec.approx_offset;
    const pos = hits.reduce((b, i) => (Math.abs(i - a) < Math.abs(b - a) ? i : b), hits[0]);
    return { start: pos, end: pos + t.length };
  }
  // 3) prefix 一致
  if (pre) {
    const p = hits.find((i) => hay.slice(Math.max(0, i - pre.length), i) === pre);
    if (p !== undefined) return { start: p, end: p + t.length };
  }
  // 4) 先頭
  return { start: hits[0], end: hits[0] + t.length };
}

export function isSingleWord(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length === 0 || trimmed.length > 20) return false;
  if (/\s/.test(trimmed)) return false;
  // 英字を含む
  return /[A-Za-z]/.test(trimmed);
}

export function extractContext(fullText: string, selected: string): string {
  if (!fullText || !selected) return selected || '';
  const idx = fullText.toLowerCase().indexOf(selected.toLowerCase());
  if (idx < 0) return selected;

  const enders = /[.!?。！？]/;

  // 後ろ向き：直前の文末（または段落頭）を探して文頭位置を決定
  let start = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = fullText[i];
    // 段落区切り
    if (ch === '\n' && i > 0 && fullText[i - 1] === '\n') {
      start = i + 1;
      break;
    }
    if (enders.test(ch)) {
      // 文末記号の直後の空白を飛ばした位置を文頭とする
      let j = i + 1;
      while (j < idx && /\s/.test(fullText[j])) j++;
      start = j;
      break;
    }
  }
  // 残余の前置き空白を除去
  while (start < idx && /\s/.test(fullText[start])) start++;

  // 前向き：最初の文末記号（または段落区切り）まで進める
  let end = fullText.length;
  for (let i = idx + selected.length; i < fullText.length; i++) {
    const ch = fullText[i];
    if (ch === '\n' && i + 1 < fullText.length && fullText[i + 1] === '\n') {
      end = i;
      break;
    }
    if (enders.test(ch)) {
      // 連続記号や末尾の閉じ括弧・引用符も含める
      let j = i + 1;
      while (j < fullText.length && /[.!?。！？]/.test(fullText[j])) j++;
      while (j < fullText.length && /["')\]」』》]/.test(fullText[j])) j++;
      end = j;
      break;
    }
  }

  return fullText.slice(start, end).trim();
}

export function speakWord(text: string, lang = 'en-US'): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const t = (text || '').trim();
  if (!t) return;
  try {
    window.speechSynthesis.cancel(); // 連続クリック時に重ならないように
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* 非対応ブラウザでは無視 */
  }
}
