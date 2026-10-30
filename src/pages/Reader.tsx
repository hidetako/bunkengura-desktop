import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookMeta, DictionaryResult, Marker, MarkerColor, MarkerStyle, TransMemo } from '@shared/types';
import { api, errText } from '../lib/bridge';
import { Spinner } from '../components/Spinner';
import { useInPaneSearch } from '../hooks/useInPaneSearch';
import { buildTextIndex, locateNormSpan, rangeForNormSpan, normOffsetForDom } from '../lib/text-marker';
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

/** {{PAGE n}} で区切られた全文を、ページごとの本文に割る。 */
function splitPages(text: string): string[] {
  if (!text.trim()) return [''];
  const parts = text.split(/\{\{PAGE\s+\d+\}\}/g).map((s) => s.trim());
  const pages = parts.filter((_, i) => i > 0 || parts[0].length > 0);
  return pages.length ? pages : [text];
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
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [memos, setMemos] = useState<TransMemo[]>([]);
  const [error, setError] = useState('');
  const [memoDraft, setMemoDraft] = useState('');

  // 表示の好みは本をまたいで覚える
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('bunkengura.fontSize')) || 17);
  const [lineHeight, setLineHeight] = useState(() => Number(localStorage.getItem('bunkengura.lineHeight')) || 1.9);
  const [maxWidth, setMaxWidth] = useState(() => Number(localStorage.getItem('bunkengura.maxWidth')) || 760);
  const [themeId, setThemeId] = useState(() => localStorage.getItem('bunkengura.readerTheme') || 'paper');
  const theme = READER_THEMES.find((t) => t.id === themeId) ?? READER_THEMES[0];

  useEffect(() => {
    localStorage.setItem('bunkengura.fontSize', String(fontSize));
    localStorage.setItem('bunkengura.lineHeight', String(lineHeight));
    localStorage.setItem('bunkengura.maxWidth', String(maxWidth));
    localStorage.setItem('bunkengura.readerTheme', themeId);
  }, [fontSize, lineHeight, maxWidth, themeId]);

  const sourceRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selTool, setSelTool] = useState<{ x: number; y: number; text: string } | null>(null);

  const pages = useMemo(() => splitPages(text), [text]);
  const pageText = pages[Math.min(page, pages.length) - 1] ?? '';
  const search = useInPaneSearch(sourceRef, [pageText, fontSize, lineHeight, maxWidth]);

  // --- 読み込み ---
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.books.text(book.id), api.markers.list(), api.memos.list()])
      .then(([t, mk, mm]) => {
        if (!alive) return;
        setText(t);
        setMarkers(mk.filter((m) => m.book_id === book.id));
        setMemos(mm.filter((m) => m.book_id === book.id));
      })
      .catch((e) => alive && setError(errText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [book.id]);

  // しおりを残す（ページを変えるたびに控える）
  useEffect(() => {
    if (loading) return;
    api.books.update(book.id, { last_page: page }).catch(() => {
      /* しおりの保存失敗で読書を止める必要はない */
    });
  }, [page, book.id, loading]);

  const goPage = (n: number) => {
    const next = Math.min(Math.max(1, n), pages.length);
    setPage(next);
    setSelTool(null);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // --- マーカーと対訳メモを本文に描く ---
  const paintHighlights = useCallback(() => {
    const root = sourceRef.current;
    const reg = (CSS as any).highlights;
    const AnyHighlight = (window as any).Highlight;
    if (!root || !reg || !AnyHighlight) return;

    for (const c of ['red', 'yellow', 'blue']) {
      for (const s of ['marker', 'underline']) reg.delete(`mk-${c}-${s}`);
    }
    reg.delete('trans-sentence');
    if (!pageText) return;

    const idx = buildTextIndex(root);
    const groups: Record<string, Range[]> = {};
    for (const m of markers) {
      const span = locateNormSpan(idx, {
        text: m.text,
        prefix: m.prefix,
        suffix: m.suffix,
        approx_offset: m.approx_offset,
      });
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
    for (const m of memos) {
      const span = locateNormSpan(idx, {
        text: m.text,
        prefix: m.prefix,
        suffix: m.suffix,
        approx_offset: m.approx_offset,
      });
      if (!span) continue;
      const r = rangeForNormSpan(idx, span.start, span.end);
      if (r) memoRanges.push(r);
    }
    if (memoRanges.length) {
      try {
        reg.set('trans-sentence', new AnyHighlight(...memoRanges));
      } catch {
        /* 同上 */
      }
    }
  }, [markers, memos, pageText]);

  useEffect(() => {
    const t = setTimeout(paintHighlights, 50);
    return () => clearTimeout(t);
  }, [paintHighlights, fontSize, lineHeight, maxWidth]);

  // 画面を離れるときにハイライトを残さない
  useEffect(
    () => () => {
      const reg = (CSS as any).highlights;
      if (!reg) return;
      for (const c of ['red', 'yellow', 'blue']) {
        for (const s of ['marker', 'underline']) reg.delete(`mk-${c}-${s}`);
      }
      reg.delete('trans-sentence');
    },
    [],
  );

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

  /** 選択範囲の位置を、本文中のどこだったか後から辿れる形で控える。 */
  const locateSelection = (selected: string) => {
    const root = sourceRef.current;
    const sel = window.getSelection();
    let approx = 0;
    if (root && sel && sel.rangeCount > 0) {
      const idx = buildTextIndex(root);
      const r = sel.getRangeAt(0);
      approx = normOffsetForDom(idx, r.startContainer, r.startOffset) ?? 0;
    }
    const i = pageText.indexOf(selected);
    return {
      prefix: i > 0 ? pageText.slice(Math.max(0, i - 30), i) : '',
      suffix: i >= 0 ? pageText.slice(i + selected.length, i + selected.length + 30) : '',
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
    const sentence = extractContext(pageText, word);
    setPane({ kind: 'loading', what: '辞書' });
    try {
      const result = await api.ai.dictionary(word, sentence);
      setPane({ kind: 'dict', result, sentence });
    } catch (e) {
      setPane({ kind: 'idle' });
      setError(errText(e));
    }
  };

  const doTranslate = async (source: string) => {
    if (!requireKey()) return;
    setSelTool(null);
    setPane({ kind: 'loading', what: '翻訳' });
    try {
      const translation = await api.ai.translate(source);
      setPane({ kind: 'translation', source, translation });
      setMemoDraft('');
    } catch (e) {
      setPane({ kind: 'idle' });
      setError(errText(e));
    }
  };

  const addMarker = async (color: MarkerColor, style: MarkerStyle) => {
    if (!selTool) return;
    const pos = locateSelection(selTool.text);
    try {
      const m = await api.markers.add({
        book_id: book.id,
        text: selTool.text,
        color,
        style,
        page,
        ...pos,
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
    const pos = locateSelection(pane.source);
    try {
      const m = await api.memos.add({
        book_id: book.id,
        source_title: book.title,
        text: pane.source,
        translation: pane.translation,
        memo: memoDraft.trim(),
        page,
        ...pos,
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
      await api.vocab.add({
        word: r.word,
        pronunciation: r.pronunciation,
        general_meaning: r.general_meaning,
        medical_meaning: r.medical_meaning,
        example: r.example,
        source_sentence: pane.sentence,
        source_book_id: book.id,
        source_title: book.title,
      });
      setPane({ kind: 'idle' });
    } catch (e) {
      setError(errText(e));
    }
  };

  // 既にマーカーが付いている箇所を選び直したときに消せるようにする
  const removeMarkerAt = async () => {
    if (!selTool) return;
    const hit = markers.find((m) => m.text.includes(selTool.text) || selTool.text.includes(m.text));
    if (!hit) {
      setError('この位置にマーカーは見つかりませんでした。');
      return;
    }
    try {
      await api.markers.remove(hit.id);
      setMarkers((prev) => prev.filter((m) => m.id !== hit.id));
      setSelTool(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError(errText(e));
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spinner label="本を開いています" size="lg" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* 上部バー */}
      <div
        className="flex items-start justify-between gap-2 px-3 py-2 border-b flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn" onClick={onBack}>
            ← 本棚
          </button>
          <span className="font-semibold">{book.title}</span>
        </div>

        <div className="flex flex-1 min-w-0 flex-wrap gap-1 items-center justify-end">
          <button
            className="btn"
            onClick={() => (search.open ? search.close() : search.openSearch())}
            title="このページ内を検索（Ctrl/⌘+F）"
            style={search.open ? { borderColor: 'var(--color-accent)' } : undefined}
          >
            🔍
          </button>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '2.8em', textAlign: 'center' }}>
              {fontSize}px
            </span>
            <button className="btn" onClick={() => setFontSize((s) => Math.min(36, s + 1))}>A+</button>
          </div>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setLineHeight((v) => Math.max(1, Math.round((v - 0.1) * 10) / 10))}>行-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '2.6em', textAlign: 'center' }}>
              {lineHeight.toFixed(1)}
            </span>
            <button className="btn" onClick={() => setLineHeight((v) => Math.min(3, Math.round((v + 0.1) * 10) / 10))}>行+</button>
          </div>
          <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <button className="btn" onClick={() => setMaxWidth((w) => Math.min(1600, w + 80))}>余白-</button>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted)', minWidth: '3.6em', textAlign: 'center' }}>
              {maxWidth}px
            </span>
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
                  width: 20,
                  height: 20,
                  padding: 0,
                  borderRadius: 4,
                  background: t.bg,
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
            {!hasApiKey && (
              <button className="btn" style={{ fontSize: 11 }} onClick={onOpenSettings}>
                設定へ
              </button>
            )}
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setError('')}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 本文 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          style={{ background: theme.bg, color: theme.color }}
        >
          <div
            className="px-6 py-6 mx-auto"
            style={{ maxWidth, fontSize, lineHeight }}
          >
            <div
              ref={sourceRef}
              className="selectable whitespace-pre-wrap"
              onMouseUp={onMouseUp}
            >
              {pageText || '(このページには本文がありません)'}
            </div>
          </div>
        </div>

        {/* 右ペイン */}
        <div
          className="overflow-y-auto border-l"
          style={{ width: 360, flexShrink: 0, borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        >
          <div className="pane-title">日本語訳 / 単語辞書</div>
          <div className="p-3">
            {pane.kind === 'idle' && (
              <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
                <p className="mb-2">本文をドラッグで選ぶと、翻訳・辞書・マーカーが選べます。</p>
                <ul className="list-disc pl-5" style={{ lineHeight: 1.8 }}>
                  <li>1単語なら辞書、文章なら翻訳が既定です</li>
                  <li>マーカーは赤・黄・青 × 塗り／下線</li>
                  <li>訳文は対訳メモとして残せます</li>
                </ul>
              </div>
            )}
            {pane.kind === 'loading' && <Spinner label={`${pane.what}を調べています`} />}

            {pane.kind === 'dict' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-base">{pane.result.word}</span>
                  {pane.result.pronunciation && (
                    <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                      {pane.result.pronunciation}
                    </span>
                  )}
                  <button className="btn" style={{ fontSize: 11 }} onClick={() => speakWord(pane.result.word)}>
                    🔊
                  </button>
                </div>
                {pane.result.base_form && (
                  <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
                    原形: {pane.result.base_form}
                  </div>
                )}
                {pane.result.context_usage && (
                  <div className="text-sm">
                    <span className="font-semibold">この文での使われ方: </span>
                    {pane.result.context_usage}
                  </div>
                )}
                {pane.result.general_meaning && <div className="text-sm">{pane.result.general_meaning}</div>}
                {pane.result.medical_meaning && (
                  <div className="text-sm" style={{ color: 'var(--color-accent)' }}>
                    {pane.result.medical_meaning}
                  </div>
                )}
                {pane.result.example && (
                  <div className="text-sm selectable" style={{ color: 'var(--color-muted)' }}>
                    {pane.result.example}
                  </div>
                )}
                <div className="flex gap-1 justify-end mt-1">
                  <button className="btn" onClick={() => setPane({ kind: 'idle' })}>閉じる</button>
                  <button className="btn btn-primary" onClick={saveVocab}>単語帳に追加</button>
                </div>
              </div>
            )}

            {pane.kind === 'translation' && (
              <div className="flex flex-col gap-2">
                <div className="text-sm selectable whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
                  {pane.source}
                </div>
                <div className="text-sm selectable whitespace-pre-wrap">{pane.translation}</div>
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
        </div>
      </div>

      {/* ページ送り */}
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

      {/* 選択ツールバー */}
      {selTool && (
        <div
          className="card p-1 flex items-center gap-1 flex-wrap"
          style={{
            position: 'fixed',
            left: Math.min(Math.max(8, selTool.x - 150), window.innerWidth - 310),
            top: Math.max(8, selTool.y - 52),
            zIndex: 60,
            maxWidth: 300,
          }}
        >
          {isSingleWord(selTool.text) ? (
            <button className="btn btn-primary" onClick={() => doDictionary(selTool.text)}>辞書</button>
          ) : (
            <button className="btn btn-primary" onClick={() => doTranslate(selTool.text)}>翻訳</button>
          )}
          <button className="btn" onClick={() => doTranslate(selTool.text)}>訳す</button>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.id}
              className="btn"
              style={{ padding: '2px 6px' }}
              title={`${c.label}のマーカー（もう一度押すと下線）`}
              onClick={() => addMarker(c.id, 'marker')}
              onContextMenu={(e) => {
                e.preventDefault();
                addMarker(c.id, 'underline');
              }}
            >
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: c.swatch }} />
            </button>
          ))}
          <button className="btn" style={{ fontSize: 11 }} onClick={removeMarkerAt} title="この箇所のマーカーを消す">
            消す
          </button>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setSelTool(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
