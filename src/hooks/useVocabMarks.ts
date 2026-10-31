// 単語帳に入れた語を、本文中でオレンジの下線にする。
// 「この語は前に調べた」が読みながら分かるようにするための印で、
// マーカーや対訳メモとは別のレイヤに描く。
import { useCallback, useEffect, useRef } from 'react';
import type { VocabEntry } from '@shared/types';
import { buildTextIndex, rangeForNormSpan, type TextIndex } from '../lib/text-marker';

const HL = 'vocab-word';

/** 語尾変化も同じ語として拾う（studies → study など） */
const SUFFIXES = 's|es|ed|d|ing|ings|ly|er|est|ment|ments|ness';

const hasCjk = (w: string) => /[぀-ヿ㐀-鿿豈-﫿]/.test(w);
const esc = (w: string) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function useVocabMarks(
  rootRef: React.RefObject<HTMLElement | null>,
  words: string[],
  enabled: boolean,
  deps: unknown[] = [],
) {
  const idxRef = useRef<TextIndex | null>(null);

  const apply = useCallback(() => {
    const reg = (CSS as any).highlights;
    const AnyHighlight = (window as any).Highlight;
    const root = rootRef.current;
    if (!reg || !AnyHighlight) return;
    if (!root || !enabled || words.length === 0) {
      reg.delete(HL);
      return;
    }
    try {
      const idx = buildTextIndex(root);
      idxRef.current = idx;

      // \b は英字にしか効かないので、和語は語境界なしで照合する
      const ascii = words.filter((w) => !hasCjk(w)).map(esc).filter(Boolean);
      const cjk = words.filter(hasCjk).map(esc).filter(Boolean);
      const parts: string[] = [];
      if (ascii.length) parts.push(`\\b(?:${ascii.join('|')})(?:${SUFFIXES})?\\b`);
      if (cjk.length) parts.push(`(?:${cjk.join('|')})`);
      if (!parts.length) {
        reg.delete(HL);
        return;
      }

      const re = new RegExp(parts.join('|'), 'g');
      const ranges: Range[] = [];
      let m: RegExpExecArray | null;
      // 印の数には上限を置く（「a」のような短い語を登録したときに固まらないように）
      while ((m = re.exec(idx.norm)) !== null && ranges.length < 3000) {
        const r = rangeForNormSpan(idx, m.index, m.index + m[0].length);
        if (r) ranges.push(r);
      }
      if (ranges.length) reg.set(HL, new AnyHighlight(...ranges));
      else reg.delete(HL);
    } catch {
      /* 非対応環境では印を出さないだけ */
    }
  }, [rootRef, words, enabled]);

  useEffect(() => {
    const t = setTimeout(apply, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, ...deps]);

  // 画面を離れるときに印を残さない
  useEffect(
    () => () => {
      try {
        (CSS as any).highlights?.delete(HL);
      } catch {
        /* 同上 */
      }
    },
    [],
  );
}
