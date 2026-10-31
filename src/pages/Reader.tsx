import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookMeta,
  DictionaryResult,
  Marker,
  MarkerColor,
  MarkerStyle,
  TransMemo,
  VocabEntry,
} from '@shared/types';
import { api, errText } from '../lib/bridge';
import { Spinner } from '../components/Spinner';
import { Splitter } from '../components/Splitter';
import { useInPaneSearch } from '../hooks/useInPaneSearch';
import { useVocabMarks } from '../hooks/useVocabMarks';
import {
  buildTextIndex,
  locateNormSpan,
  normOffsetForDom,
  rangeForNormSpan,
  scrollContainerOf,
} from '../lib/text-marker';
import { extractContext, isSingleWord, speakWord } from '../lib/utils';

const READER_THEMES = [
  { id: 'paper', label: '紙', bg: '#faf8f3', color: '#1d1b16' },
  { id: 'white', label: '白', bg: '#ffffff', color: '#171a21' },
  { id: 'sepia', label: 'セピア', bg: '#f3e9d2', color: '#3b2f1c' },
  { id: 'night', label: '夜', bg: '#15181f', color: '#d6dae3' },
];

const MARKER_COLORS: { id: MarkerColor; label: string; swatch: string }[] = [
  { id: 'red', label: '赤', swatch: '#ff5252' },
  { id: 'yellow', label: '黄', swatch: '#ffd600' },
  { id: 'blue', label: '青', swatch: '#409cff' },
];

const MK_KEYS = ['red', 'yellow', 'blue'].flatMap((c) =>
  ['marker', 'underline'].map((s) => `mk-${c}-${s}`),
);

/** {{PAGE n}} 区切りの全文を、ページ番号つきの配列に割る。 */
function splitPages(text: string): { page: number; body: string }[] {
  if (!text.trim()) return [{ page: 1, body: '' }];
  const out: { page: number; body: string }[] = [];
  for (const chunk of text.split(/(?=\{\{PAGE\s+\d+\}\})/g)) {
    const m = chunk.match(/^\{\{PAGE\s+(\d+)\}\}/);
    if (m) out.push({ page: Number(m[1]), body: chunk.replace(/^\{\{PAGE\s+\d+\}\}\s*/, '').trim() });
    else if (chunk.trim()) out.push({ page: out.length + 1, body: chunk.trim() });
  }
  return out.length ? out : [{ page: 1, body: text }];
}

type Pane =
  | { kind: 'idle' }
  | { kind: 'loading'; what: '辞書' | '翻訳' }
  | { kind: 'dict'; result: DictionaryResult; sentence: string }
  | { kind: 'translation'; source: string; translation: string };

export function Reader({
  book,
  hasApiKey,
  onBack,
  onOpenSettings,
}: {
  book: BookMeta;
  hasApiKey: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(Math.max(1, book.last_page || 1));
  const [pane, setPane] = useState<Pane>({ kind: 'idle' });
  const [tab, setTab] = useState<'ai' | 'notes'>('ai');
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [memos, setMemos] = useState<TransMemo[]>([]);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [error, setError] = useState('');
  const [memoDraft, setMemoDraft] = useState('');
  const [editingMemo, setEditingMemo] = useState<TransMemo | null>(null);
  const [hoverMemo, setHoverMemo] = useState<{ memo: TransMemo; x: number; y: number } | null>(null);

  // 本ごとの読み方（縦書き・連続スクロール）
  const [vertical, setVertical] = useState(book.vertical);
  const [continuous, setContinuous] = useState(book.continuous);
  const [showVocabMarks, setShowVocabMarks] = useState(
    () => localStorage.getItem('bunkengura.vocabMarks') !== 'off',
  );

  // 表示の好みは本をまたいで覚える
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('bunkengura.fontSize')) || 17);
  const [lineHeight, setLineHeight] = useState(() => Number(localStorage.getItem('bunkengura.lineHeight')) || 1.9);
  const [maxWidth, setMaxWidth] = useState(() => Number(localStorage.getItem('bunkengura.maxWidth')) || 760);
  const [paneWidth, setPaneWidth] = useState(() => Number(localStorage.getItem('bunkengura.paneWidth')) || 380);
  const [themeId, setThemeId] = useState(() => localStorage.getItem('bunkengura.readerTheme') || 'paper');
  const theme = READER_THEMES.find((t) => t.id === themeId) ?? READER_THEMES[0];

  useEffect(() => {
    localStorage.setItem('bunkengura.fontSize', String(fontSize));
    localStorage.setItem('bunkengura.lineHeight', String(lineHeight));
    localStorage.setItem('bunkengura.maxWidth', String(maxWidth));
    localStorage.setItem('bunkengura.paneWidth', String(paneWidth));
    localStorage.setItem('bunkengura.readerTheme', themeId);
    localStorage.setItem('bunkengura.vocabMarks', showVocabMarks ? 'on' : 'off');
  }, [fontSize, lineHeight, maxWidth, paneWidth, themeId, showVocabMarks]);

  const sourceRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selTool, setSelTool] = useState<{ x: number; y: number; text: string } | null>(null);

  const pages = useMemo(() => splitPages(text), [text]);
  const pageIdx = Math.min(Math.max(1, page), pages.length) - 1;
  const shownPages = continuous ? pages : [pages[pageIdx]];
  const shownText = shownPages.map((p) => p?.body ?? '').join('\n\n');

  const search = useInPaneSearch(sourceRef, [shownText, fontSize, lineHeight, maxWidth, vertical]);
  const vocabWords = useMemo(() => vocab.map((v) => v.word).filter(Boolean), [vocab]);
  useVocabMarks(sourceRef, vocabWords, showVocabMarks, [
    shownText,
    fontSize,
    lineHeight,
    maxWidth,
    vertical,
  ]);

  // --- 読み込み ---
  const reloadNotes = useCallback(async () => {
    const [mk, mm, vv] = await Promise.all([api.markers.list(), api.memos.list(), api.vocab.list()]);
    setMarkers(mk.filter((m) => m.book_id === book.id));
    setMemos(mm.filter((m) => m.book_id === book.id));
    setVocab(vv);
  }, [book.id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.books.text(book.id), reloadNotes()])
      .then(([t]) => {
        if (alive) setText(t);
      })
      .catch((e) => alive && setError(errText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [book.id, reloadNotes]);

  // しおり・読み方を控える
  useEffect(() => {
    if (loading) return;
    api.books.update(book.id, { last_page: page, vertical, continuous }).catch(() => {
      /* 保存に失敗しても読書は止めない */
    });
  }, [page, vertical, continuous, book.id, loading]);

  const goPage = (n: number) => {
    const next = Math.min(Math.max(1, n), pages.length);
    setPage(next);
    setSelTool(null);
    if (continuous) {
      sourceRef.current
        ?.querySelector(`[data-page="${pages[next - 1]?.page}"]`)
        ?.scrollIntoView({ block: 'start' });
    } else {
      scrollRef.current?.scrollTo({ top: 0, left: vertical ? 999999 : 0 });
    }
  };

  // --- マーカーと対訳メモを本文に描く ---
  const memoSpansRef = useRef<{ s: number; e: number; memo: TransMemo }[]>([]);
  const memoIdxRef = useRef<ReturnType<typeof buildTextIndex> | null>(null);

  const paintHighlights = useCallback(() => {
    const root = sourceRef.current;
    const reg = (CSS as any).highlights;
    const AnyHighlight = (window as any).Highlight;
    if (!root || !reg || !AnyHighlight) return;

    for (const k of MK_KEYS) reg.delete(k);
    reg.delete('trans-sentence');
    memoSpansRef.current = [];
    if (!shownText) return;

    const idx = buildTextIndex(root);
    memoIdxRef.current = idx;

    const groups: Record<string, Range[]> = {};
    for (const m of markers) {
      const span = locateNormSpan(idx, m);
      if (!span) continue;
      const r = rangeForNormSpan(idx, span.start, span.end);
      if (r) (groups[`mk-${m.color}-${m.style}`] ||= []).push(r);
    }
    for (const [k, rs] of Object.entries(groups)) {
      try {
        reg.set(k, new AnyHighlight(...rs));
      } catch {
        /* 非対応環境は無視 */
      }
    }

    const memoRanges: Range[] = [];
    const spans: { s: number; e: number; memo: TransMemo }[] = [];
    for (const m of memos) {
      const span = locateNormSpan(idx, m);
      if (!span) continue;
      const r = rangeForNormSpan(idx, span.start, span.end);
      if (r) {
        memoRanges.push(r);
        spans.push({ s: span.start, e: span.end, memo: m });
      }
    }
    memoSpansRef.current = spans;
    if (memoRanges.length) {
      try {
        reg.set('trans-sentence', new AnyHighlight(...memoRanges));
      } catch {
        /* 同上 */
      }
    }
  }, [markers, memos, shownText]);

  useEffect(() => {
    const t = setTimeout(paintHighlights, 60);
    return () => clearTimeout(t);
  }, [paintHighlights, fontSize, lineHeight, maxWidth, vertical]);

  useEffect(
    () => () => {
      const reg = (CSS as any).highlights;
      if (!reg) return;
      for (const k of MK_KEYS) reg.delete(k);
      reg.delete('trans-sentence');
    },
    [],
  );

  /** 画面座標から、その位置にある対訳メモを割り出す。 */
  const memoAt = (clientX: number, clientY: number): TransMemo | null => {
    const idx = memoIdxRef.current;
    const spans = memoSpansRef.current;
    if (!idx || !spans.length) return null;
    const doc: any = document;
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretRangeFromPoint) {
      const cr = doc.caretRangeFromPoint(clientX, clientY);
      if (cr) {
        node = cr.startContainer;
        offset = cr.startOffset;
      }
    } else if (doc.caretPositionFromPoint) {
      const cp = doc.caretPositionFromPoint(clientX, clientY);
      if (cp) {
        node = cp.offsetNode;
        offset = cp.offset;
      }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const pos = normOffsetForDom(idx, node, offset);
    if (pos === undefined) return null;
    return spans.find((sp) => pos >= sp.s && pos < sp.e)?.memo ?? null;
  };

  const onSourceMouseMove = (e: React.MouseEvent) => {
    const m = memoAt(e.clientX, e.clientY);
    if (m) setHoverMemo((p) => (p && p.memo.id === m.id ? p : { memo: m, x: e.clientX, y: e.clientY }));
    else setHoverMemo((p) => (p ? null : p));
  };

  const onSourceClick = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const m = memoAt(e.clientX, e.clientY);
    if (m) {
      setHoverMemo(null);
      setEditingMemo(m);
    }
  };

  // --- 選択 ---
  const onMouseUp = () => {
    const sel = window.getSelection();
    const s = sel?.toString().trim() ?? '';
    if (!s || !sel || sel.rangeCount === 0) {
      setSelTool(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelTool({ x: rect.left + rect.width / 2, y: rect.top, text: s });
  };

  /** 選択範囲の位置を、後から同じ箇所へ当て直せる形で控える。 */
  const locateSelection = (selected: string) => {
    const root = sourceRef.current;
    const sel = window.getSelection();
    let approx = 0;
    if (root && sel && sel.rangeCount > 0) {
      const idx = buildTextIndex(root);
      const r = sel.getRangeAt(0);
      approx = normOffsetForDom(idx, r.startContainer, r.startOffset) ?? 0;
    }
    const i = shownText.indexOf(selected);
    return {
      prefix: i > 0 ? shownText.slice(Math.max(0, i - 30), i) : '',
      suffix: i >= 0 ? shownText.slice(i + selected.length, i + selected.length + 30) : '',
      approx_offset: approx,
    };
  };

  const requireKey = (): boolean => {
    if (hasApiKey) return true;
    setError('APIキーが未設定です。設定画面で入力してください。');
    return false;
  };

  const doDictionary = async (word: string) => {
    if (!requireKey()) return;
    setSelTool(null);
    setTab('ai');
    const sentence = extractContext(shownText, word);
    setPane({ kind: 'loading', what: '辞書' });
    try {
      setPane({ kind: 'dict', result: await api.ai.dictionary(word, sentence), sentence });
    } catch (e) {
      setPane({ kind: 'idle' });
      setError(errText(e));
    }
  };

  const doTranslate = async (source: string) => {
    if (!requireKey()) return;
    setSelTool(null);
    setTab('ai');
    setPane({ kind: 'loading', what: '翻訳' });
    try {
      setPane({ kind: 'translation', source, translation: await api.ai.translate(source) });
      setMemoDraft('');
    } catch (e) {
      setPane({ kind: 'idle' });
      setError(errText(e));
    }
  };

  const addMarker = async (color: MarkerColor, style: MarkerStyle) => {
    if (!selTool) return;
    try {
      const m = await api.markers.add({
        book_id: book.id,
        text: selTool.text,
        color,
        style,
        page: continuous ? page : pages[pageIdx].page,
        ...locateSelection(selTool.text),
      });
      setMarkers((prev) => [m, ...prev]);
      setSelTool(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError(errText(e));
    }
  };

  const saveMemo = async () => {
    if (pane.kind !== 'translation') return;
    try {
      const m = await api.memos.add({
        book_id: book.id,
        source_title: book.title,
        text: pane.source,
        translation: pane.translation,
        memo: memoDraft.trim(),
        page: continuous ? page : pages[pageIdx].page,
        ...locateSelection(pane.source),
      });
      setMemos((prev) => [m, ...prev]);
      setMemoDraft('');
      setPane({ kind: 'idle' });
    } catch (e) {
      setError(errText(e));
    }
  };

  const saveVocab = async () => {
    if (pane.kind !== 'dict') return;
    const r = pane.result;
    try {
      const v = await api.vocab.add({
        word: r.word,
        pronunciation: r.pronunciation,
        general_meaning: r.general_meaning,
        medical_meaning: r.medical_meaning,
        example: r.example,
        source_sentence: pane.sentence,
        source_book_id: book.id,
        source_title: book.title,
      });
      setVocab((prev) => [v, ...prev]); // 本文の印にもすぐ反映される
      setPane({ kind: 'idle' });
    } catch (e) {
      setError(errText(e));
    }
  };

  const removeMarker = async (id: string) => {
    try {
      await api.markers.remove(id);
      setMarkers((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(errText(e));
    }
  };

  const removeMemo = async (id: string) => {
    try {
      await api.memos.remove(id);
      setMemos((prev) => prev.filter((m) => m.id !== id));
      setEditingMemo(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  const updateMemo = async (m: TransMemo, patch: Partial<TransMemo>) => {
    try {
      const next = await api.memos.update(m.id, patch);
      setMemos((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      setEditingMemo(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  /** 書き込み一覧から、その箇所へ飛ぶ。 */
  const jumpTo = (rec: { text: string; prefix: string; suffix: string; approx_offset: number; page: number }) => {
    if (!continuous && rec.page) setPage(rec.page);
    setTimeout(() => {
      const root = sourceRef.current;
      if (!root) return;
      const idx = buildTextIndex(root);
      const span = locateNormSpan(idx, rec);
      if (!span) return;
      const r = rangeForNormSpan(idx, span.start, span.end);
      if (!r) return;
      const el = r.startContainer.parentElement;
      const cont = scrollContainerOf(el);
      const tr = r.getBoundingClientRect();
      if (cont) {
        const cr = cont.getBoundingClientRect();
        if (vertical) cont.scrollLeft += tr.left - cr.left - cont.clientWidth / 2;
        else cont.scrollTop += tr.top - cr.top - cont.clientHeight / 2;
      } else el?.scrollIntoView({ block: 'center' });
      try {
        (CSS as any).highlights?.set('vocab-hit', new (window as any).Highlight(r));
        setTimeout(() => (CSS as any).highlights?.delete('vocab-hit'), 4000);
      } catch {
        /* 非対応環境では飛ぶだけ */
      }
    }, 120);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spinner label="本を開いています" size="lg" />
      </div>
    );
  }

  const bodyStyle: React.CSSProperties = vertical
    ? { writingMode: 'vertical-rl', height: '100%', fontSize, lineHeight, maxBlockSize: maxWidth }
    : { fontSize, lineHeight, maxWidth, margin: '0 auto' };

  return (
    <div className="h-screen flex flex-col">
      {/* 上部バー */}
      <div
        className="flex items-start justify-between gap-2 px-3 py-2 border-b flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn" onClick={onBack}>← 本棚</button>
          <span className="font-semibold">{book.title}</span>
          {book.source === 'none' && (
            <span className="text-xs" style={{ color: 'var(--color-warn)' }}>
              本文がありません（本棚で「画像から書き起こす」）
            </span>
          )}
        </div>

        <div className="flex flex-1 min-w-0 flex-wrap gap-1 items-center justify-end">
          <button
            className="btn"
            onClick={() => (search.open ? search.close() : search.openSearch())}
            title="このページ内を検索（Ctrl/⌘+F）"
            style={search.open ? { borderColor: 'var(--color-accent)' } : undefined}
          >🔍</button>
          <button
            className={vertical ? 'btn btn-primary' : 'btn'}
            onClick={() => setVertical((v) => !v)}
            title="縦書き / 横書きを切り替える"
          >{vertical ? '縦書き' : '横書き'}</button>
          <button
            className={continuous ? 'btn btn-primary' : 'btn'}
            onClick={() => setContinuous((v) => !v)}
            title="ページ送り / 連続スクロールを切り替える"
          >{continuous ? '連続' : 'ページ'}</button>
          <button
            className={showVocabMarks ? 'btn btn-primary' : 'btn'}
            onClick={() => setShowVocabMarks((v) => !v)}
            title="単語帳に入れた語を本文で下線表示する"
          >単語印</button>

          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '2.8em', textAlign: 'center' }}>{fontSize}px</span>
            <button className="btn" onClick={() => setFontSize((s) => Math.min(36, s + 1))}>A+</button>
          </div>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setLineHeight((v) => Math.max(1, Math.round((v - 0.1) * 10) / 10))}>行-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '2.6em', textAlign: 'center' }}>{lineHeight.toFixed(1)}</span>
            <button className="btn" onClick={() => setLineHeight((v) => Math.min(3, Math.round((v + 0.1) * 10) / 10))}>行+</button>
          </div>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setMaxWidth((w) => Math.min(1600, w + 80))}>余白-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '3.6em', textAlign: 'center' }}>{maxWidth}px</span>
            <button className="btn" onClick={() => setMaxWidth((w) => Math.max(400, w - 80))}>余白+</button>
          </div>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            {READER_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setThemeId(t.id)}
                title={t.label}
                aria-label={`配色: ${t.label}`}
                style={{
                  width: 20, height: 20, padding: 0, borderRadius: 4, background: t.bg,
                  border: themeId === t.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        {search.open && (
          <div className="w-full flex items-center gap-1 pt-1">
            <input
              ref={search.inputRef}
              className="input flex-1"
              style={{ fontSize: 12, padding: '2px 6px', minWidth: 0 }}
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              onKeyDown={search.onInputKeyDown}
              placeholder="このページ内を検索（Enter=次 / Shift+Enter=前）"
              aria-label="ページ内検索"
              autoComplete="off"
              spellCheck={false}
            />
            <span
              className="text-[10px] tabular-nums"
              style={{ color: 'var(--color-muted)', minWidth: '4.5em', textAlign: 'center' }}
              aria-live="polite"
            >
              {search.query.trim() === '' ? '' : search.count === 0 ? '0件' : `${search.position}/${search.count}`}
            </span>
            <button className="btn" onClick={search.prev} disabled={search.count === 0} aria-label="前のヒット">▲</button>
            <button className="btn" onClick={search.next} disabled={search.count === 0} aria-label="次のヒット">▼</button>
            <button className="btn" onClick={search.close} aria-label="検索を閉じる">✕</button>
          </div>
        )}
      </div>

      {error && (
        <div
          className="px-3 py-2 text-sm flex items-center justify-between"
          style={{ background: 'rgba(185,28,28,0.12)', color: 'var(--color-danger)' }}
        >
          <span>{error}</span>
          <div className="flex gap-1">
            {!hasApiKey && <button className="btn" style={{ fontSize: 11 }} onClick={onOpenSettings}>設定へ</button>}
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setError('')}>閉じる</button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 本文 */}
        <div
          ref={scrollRef}
          className={vertical ? 'flex-1 overflow-x-auto overflow-y-hidden reader-hscroll' : 'flex-1 overflow-y-auto'}
          style={{ background: theme.bg, color: theme.color }}
        >
          <div className="px-6 py-6" style={{ height: vertical ? '100%' : undefined }}>
            <div
              ref={sourceRef}
              className="selectable whitespace-pre-wrap"
              style={bodyStyle}
              onMouseUp={onMouseUp}
              onMouseMove={onSourceMouseMove}
              onMouseLeave={() => setHoverMemo(null)}
              onClick={onSourceClick}
            >
              {shownPages.map((p, i) =>
                p ? (
                  <div key={p.page} data-page={p.page} style={{ marginBottom: continuous ? '2.5em' : 0 }}>
                    {continuous && i > 0 && (
                      <div
                        className="text-xs"
                        style={{ color: 'var(--color-muted)', opacity: 0.6, marginBottom: '0.8em' }}
                      >
                        — {p.page} —
                      </div>
                    )}
                    {p.body || '(このページには本文がありません)'}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <Splitter
          vertical
          onDrag={(d) => setPaneWidth((w) => Math.min(760, Math.max(240, w - d)))}
        />

        {/* 右ペイン */}
        <div
          className="overflow-y-auto"
          style={{ width: paneWidth, flexShrink: 0, background: 'var(--color-card)' }}
        >
          <div className="pane-title flex items-center gap-1">
            <button
              className={tab === 'ai' ? 'btn btn-primary' : 'btn'}
              style={{ fontSize: 11 }}
              onClick={() => setTab('ai')}
            >日本語訳 / 辞書</button>
            <button
              className={tab === 'notes' ? 'btn btn-primary' : 'btn'}
              style={{ fontSize: 11 }}
              onClick={() => setTab('notes')}
            >書き込み（{markers.length + memos.length}）</button>
          </div>

          {tab === 'ai' && (
            <div className="p-3">
              {pane.kind === 'idle' && (
                <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  <p className="mb-2">本文をドラッグで選ぶと、翻訳・辞書・マーカーが選べます。</p>
                  <ul className="list-disc pl-5" style={{ lineHeight: 1.8 }}>
                    <li>1単語なら辞書、文章なら翻訳が既定です</li>
                    <li>マーカーは左クリックで塗り、右クリックで下線</li>
                    <li>橙の下線は、単語帳に入れた語です</li>
                    <li>緑の地色は対訳メモ。クリックで編集できます</li>
                  </ul>
                </div>
              )}
              {pane.kind === 'loading' && <Spinner label={`${pane.what}を調べています`} />}

              {pane.kind === 'dict' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-base">{pane.result.word}</span>
                    {pane.result.pronunciation && (
                      <span className="text-sm" style={{ color: 'var(--color-muted)' }}>{pane.result.pronunciation}</span>
                    )}
                    <button className="btn" style={{ fontSize: 11 }} onClick={() => speakWord(pane.result.word)} title="発音を聞く">🔊</button>
                  </div>
                  {pane.result.base_form && (
                    <div className="text-sm" style={{ color: 'var(--color-muted)' }}>原形: {pane.result.base_form}</div>
                  )}
                  {pane.result.context_usage && (
                    <div className="text-sm"><span className="font-semibold">この文での使われ方: </span>{pane.result.context_usage}</div>
                  )}
                  {pane.result.general_meaning && <div className="text-sm">{pane.result.general_meaning}</div>}
                  {pane.result.medical_meaning && (
                    <div className="text-sm" style={{ color: 'var(--color-accent)' }}>{pane.result.medical_meaning}</div>
                  )}
                  {pane.result.example && (
                    <div className="text-sm selectable" style={{ color: 'var(--color-muted)' }}>{pane.result.example}</div>
                  )}
                  <div className="flex gap-1 justify-end mt-1">
                    <button className="btn" onClick={() => setPane({ kind: 'idle' })}>閉じる</button>
                    <button className="btn btn-primary" onClick={saveVocab}>単語帳に追加</button>
                  </div>
                </div>
              )}

              {pane.kind === 'translation' && (
                <div className="flex flex-col gap-2">
                  <div className="text-sm selectable whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{pane.source}</div>
                  <div className="flex items-start gap-1">
                    <div className="text-sm selectable whitespace-pre-wrap flex-1">{pane.translation}</div>
                    <button
                      className="btn"
                      style={{ fontSize: 11 }}
                      onClick={() => speakWord(pane.source, 'en-US')}
                      title="原文を読み上げる"
                    >🔊</button>
                  </div>
                  <textarea
                    className="input"
                    rows={3}
                    value={memoDraft}
                    onChange={(e) => setMemoDraft(e.target.value)}
                    placeholder="メモ（任意）"
                  />
                  <div className="flex gap-1 justify-end">
                    <button className="btn" onClick={() => setPane({ kind: 'idle' })}>閉じる</button>
                    <button className="btn btn-primary" onClick={saveMemo}>対訳メモに残す</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="p-3 flex flex-col gap-3">
              {markers.length === 0 && memos.length === 0 && (
                <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  この本にはまだ書き込みがありません。
                </div>
              )}

              {memos.length > 0 && (
                <div>
                  <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>対訳メモ</div>
                  <div className="flex flex-col gap-1">
                    {[...memos].sort((a, b) => a.page - b.page).map((m) => (
                      <div key={m.id} className="card p-2 text-sm">
                        <div className="flex items-baseline gap-1">
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{m.page}p</span>
                          <button className="btn" style={{ fontSize: 10 }} onClick={() => jumpTo(m)}>飛ぶ</button>
                          <div className="flex-1" />
                          <button className="btn" style={{ fontSize: 10 }} onClick={() => setEditingMemo(m)}>編集</button>
                        </div>
                        <div className="mt-1 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{m.text.slice(0, 70)}</div>
                        <div style={{ color: 'var(--color-accent)' }}>{m.translation.slice(0, 70)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {markers.length > 0 && (
                <div>
                  <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>マーカー</div>
                  <div className="flex flex-col gap-1">
                    {[...markers].sort((a, b) => a.page - b.page).map((m) => (
                      <div key={m.id} className="card p-2 text-sm flex items-baseline gap-1">
                        <span
                          style={{
                            display: 'inline-block', width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                            background: MARKER_COLORS.find((c) => c.id === m.color)?.swatch,
                          }}
                        />
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{m.page}p</span>
                        <span className="flex-1 truncate">{m.text.slice(0, 40)}</span>
                        <button className="btn" style={{ fontSize: 10 }} onClick={() => jumpTo(m)}>飛ぶ</button>
                        <button
                          className="btn"
                          style={{ fontSize: 10, color: 'var(--color-danger)' }}
                          onClick={() => removeMarker(m.id)}
                        >消す</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ページ送り（連続スクロールのときは出さない） */}
      {!continuous && (
        <div
          className="flex items-center justify-center gap-2 px-3 py-2 border-t"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        >
          <button className="btn" onClick={() => goPage(1)} disabled={page <= 1}>⏮</button>
          <button className="btn" onClick={() => goPage(page - 1)} disabled={page <= 1}>← 前</button>
          <input
            className="input tabular-nums"
            style={{ width: 70, textAlign: 'center' }}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''));
              if (n) goPage(n);
            }}
            aria-label="ページ番号"
          />
          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>/ {pages.length}</span>
          <button className="btn" onClick={() => goPage(page + 1)} disabled={page >= pages.length}>次 →</button>
          <button className="btn" onClick={() => goPage(pages.length)} disabled={page >= pages.length}>⏭</button>
        </div>
      )}

      {/* 対訳メモのホバー表示 */}
      {hoverMemo && !editingMemo && (
        <div
          className="card p-2 text-sm"
          style={{
            position: 'fixed',
            left: Math.min(hoverMemo.x + 12, window.innerWidth - 340),
            top: Math.min(hoverMemo.y + 14, window.innerHeight - 160),
            zIndex: 70, maxWidth: 320, pointerEvents: 'none',
          }}
        >
          <div style={{ color: 'var(--color-accent)' }}>{hoverMemo.memo.translation.slice(0, 160)}</div>
          {hoverMemo.memo.memo && (
            <div className="mt-1" style={{ color: 'var(--color-memo)' }}>📝 {hoverMemo.memo.memo}</div>
          )}
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>クリックで編集</div>
        </div>
      )}

      {/* 対訳メモの編集 */}
      {editingMemo && (
        <MemoEditor
          memo={editingMemo}
          onClose={() => setEditingMemo(null)}
          onSave={(patch) => updateMemo(editingMemo, patch)}
          onDelete={() => removeMemo(editingMemo.id)}
        />
      )}

      {/* 選択ツールバー */}
      {selTool && (
        <div
          className="card p-1 flex items-center gap-1 flex-wrap"
          style={{
            position: 'fixed',
            left: Math.min(Math.max(8, selTool.x - 160), window.innerWidth - 330),
            top: Math.max(8, selTool.y - 52),
            zIndex: 60, maxWidth: 320,
          }}
        >
          {isSingleWord(selTool.text) ? (
            <button className="btn btn-primary" onClick={() => doDictionary(selTool.text)}>辞書</button>
          ) : (
            <button className="btn btn-primary" onClick={() => doTranslate(selTool.text)}>翻訳</button>
          )}
          <button className="btn" onClick={() => doTranslate(selTool.text)}>訳す</button>
          <button className="btn" onClick={() => speakWord(selTool.text, 'en-US')} title="読み上げる">🔊</button>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.id}
              className="btn"
              style={{ padding: '2px 6px' }}
              title={`${c.label}のマーカー（右クリックで下線）`}
              onClick={() => addMarker(c.id, 'marker')}
              onContextMenu={(e) => {
                e.preventDefault();
                addMarker(c.id, 'underline');
              }}
            >
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: c.swatch }} />
            </button>
          ))}
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setSelTool(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

/** 対訳メモの編集ダイアログ。訳文とメモを直せる。 */
function MemoEditor({
  memo,
  onClose,
  onSave,
  onDelete,
}: {
  memo: TransMemo;
  onClose: () => void;
  onSave: (patch: Partial<TransMemo>) => void;
  onDelete: () => void;
}) {
  const [translation, setTranslation] = useState(memo.translation);
  const [note, setNote] = useState(memo.memo);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg p-4" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="font-semibold mb-2">対訳メモ（{memo.page}ページ）</div>
        <div className="text-sm mb-2 selectable whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
          {memo.text}
        </div>
        <label className="text-xs" style={{ color: 'var(--color-muted)' }}>訳文</label>
        <textarea
          className="input w-full mb-2"
          rows={5}
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
        />
        <label className="text-xs" style={{ color: 'var(--color-muted)' }}>メモ</label>
        <textarea
          className="input w-full mb-3"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-between">
          <button
            className="btn"
            style={{ color: 'var(--color-danger)' }}
            onClick={() => {
              if (confirm('この対訳メモを削除します。')) onDelete();
            }}
          >🗑 削除</button>
          <div className="flex gap-1">
            <button className="btn" onClick={onClose}>やめる</button>
            <button className="btn btn-primary" onClick={() => onSave({ translation, memo: note })}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
