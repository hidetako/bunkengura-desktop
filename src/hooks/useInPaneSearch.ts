
// 本文ペイン内の語句検索（表示中の本文だけを対象。全文横断の索引は作らない）。
// 既存のマーカー類と同じ CSS Custom Highlight API を使い、別レイヤ
// （search-hit / search-current）として重ねるので、単語印・対訳印は消えない。
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildTextIndex, rangeForNormSpan, scrollContainerOf } from '@/lib/text-marker';

const HL_ALL = 'search-hit';
const HL_CUR = 'search-current';
const MAX_HITS = 2000; // 「a」のような1文字検索で描画が固まらないよう上限を設ける

function clearSearchHighlights() {
  const reg = (CSS as any).highlights;
  if (!reg) return;
  try {
    reg.delete(HL_ALL);
  } catch {}
  try {
    reg.delete(HL_CUR);
  } catch {}
}

export type InPaneSearch = {
  open: boolean;
  query: string;
  setQuery: (v: string) => void;
  /** ヒット総数（MAX_HITS で打ち切られる場合あり） */
  count: number;
  /** 現在のヒット番号（1始まり）。0件なら 0 */
  position: number;
  next: () => void;
  prev: () => void;
  openSearch: () => void;
  close: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  /** 入力欄の onKeyDown に渡す（Enter=次, Shift+Enter=前, Esc=閉じる） */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * @param rootRef 検索対象の本文要素
 * @param deps    本文の描画が変わる値（本文テキスト・文字サイズなど）。変化で索引を作り直す
 */
export function useInPaneSearch(
  rootRef: React.RefObject<HTMLElement | null>,
  deps: unknown[] = [],
): InPaneSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState(0); // 0始まり
  const [gen, setGen] = useState(0); // 索引を作り直した世代（ヒット数が同じでも再描画させる）
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangesRef = useRef<Range[]>([]);

  const setQuery = useCallback((v: string) => {
    setQueryState(v);
    setCursor(0); // 語が変わったら先頭のヒットへ
  }, []);

  // === ヒットの洗い出し（入力が落ち着いてから） ===
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const root = rootRef.current;
      // buildTextIndex の norm は「空白畳み込み＋小文字化」済みなので、検索語も同じ形に揃える
      const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!root || !q) {
        rangesRef.current = [];
        clearSearchHighlights();
        setCount(0);
        setCursor(0);
        setGen((g) => g + 1);
        return;
      }
      const idx = buildTextIndex(root);
      const ranges: Range[] = [];
      let from = 0;
      while (ranges.length < MAX_HITS) {
        const i = idx.norm.indexOf(q, from);
        if (i < 0) break;
        const r = rangeForNormSpan(idx, i, i + q.length);
        if (r) ranges.push(r);
        from = i + q.length; // 重なりは拾わない（ブラウザの検索と同じ挙動）
      }
      rangesRef.current = ranges;
      setCount(ranges.length);
      setCursor((c) => (ranges.length ? Math.min(c, ranges.length - 1) : 0));
      setGen((g) => g + 1);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, ...deps]);

  // === ハイライト描画＋現在ヒットへスクロール ===
  useEffect(() => {
    const ranges = rangesRef.current;
    if (!open || ranges.length === 0) {
      clearSearchHighlights();
      return;
    }
    const cur = ranges[Math.min(cursor, ranges.length - 1)];
    const anyWin = window as any;
    const reg = (CSS as any).highlights;
    if (anyWin.Highlight && reg) {
      try {
        // priority を単語印・対訳印より高くして、検索ヒットを最前面に塗る
        const all = new anyWin.Highlight(...ranges);
        all.priority = 10;
        reg.set(HL_ALL, all);
        const one = new anyWin.Highlight(cur);
        one.priority = 11;
        reg.set(HL_CUR, one);
      } catch {}
    } else {
      // Highlight API 非対応ブラウザ：標準の選択表示で代替する
      try {
        const sel = window.getSelection?.();
        sel?.removeAllRanges();
        sel?.addRange(cur.cloneRange());
      } catch {}
    }
    // 画面外のときだけ中央へ寄せる（入力の途中で表示が揺れないように）
    try {
      const node = cur.startContainer;
      const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) ?? null;
      const cont = scrollContainerOf(el);
      const tr = cur.getBoundingClientRect();
      if (cont) {
        const cr = cont.getBoundingClientRect();
        if (tr.top < cr.top + 8 || tr.bottom > cr.bottom - 8) {
          cont.scrollTop += tr.top - cr.top - cont.clientHeight / 2 + tr.height / 2;
        }
      } else if (tr.top < 0 || tr.bottom > window.innerHeight) {
        el?.scrollIntoView({ block: 'center' });
      }
    } catch {}
  }, [open, cursor, gen]);

  // 離脱時にハイライトを残さない
  useEffect(() => () => clearSearchHighlights(), []);

  const next = useCallback(() => {
    const n = rangesRef.current.length;
    if (n) setCursor((c) => (c + 1) % n); // 末尾の次は先頭へ
  }, []);
  const prev = useCallback(() => {
    const n = rangesRef.current.length;
    if (n) setCursor((c) => (c - 1 + n) % n);
  }, []);

  const openSearch = useCallback(() => {
    setOpen(true);
    // 開いた直後／既に開いている場合とも、入力欄を選択状態にして打ち替えやすくする
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQueryState('');
    setCount(0);
    setCursor(0);
    rangesRef.current = [];
    clearSearchHighlights();
  }, []);

  // Ctrl/Cmd+F で検索バーを開く（本文を読みながら使う機能なので標準の検索より優先）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [next, prev, close],
  );

  return {
    open,
    query,
    setQuery,
    count,
    position: count ? Math.min(cursor, count - 1) + 1 : 0,
    next,
    prev,
    openSearch,
    close,
    inputRef,
    onInputKeyDown,
  };
}
