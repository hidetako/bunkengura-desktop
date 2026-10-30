import { useEffect, useMemo, useState } from 'react';
import type { BookMeta, TransMemo } from '@shared/types';
import { api, errText } from '../lib/bridge';

export function Memos({
  books,
  onOpen,
  onError,
}: {
  books: BookMeta[];
  onOpen: (bookId: string) => void;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<TransMemo[]>([]);
  const [q, setQ] = useState('');
  const [bookFilter, setBookFilter] = useState('');

  const reload = () =>
    api.memos
      .list()
      .then(setItems)
      .catch((e) => onError(errText(e)));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    let list = bookFilter ? items.filter((m) => m.book_id === bookFilter) : items;
    if (k) {
      list = list.filter((m) =>
        [m.text, m.translation, m.memo, m.source_title].some((s) => (s || '').toLowerCase().includes(k)),
      );
    }
    // 同じ本の中ではページ順に並べる（読み返すときに追いやすい）
    return [...list].sort((a, b) =>
      a.book_id === b.book_id ? a.page - b.page : a.source_title.localeCompare(b.source_title, 'ja'),
    );
  }, [items, q, bookFilter]);

  const remove = async (m: TransMemo) => {
    if (!confirm('この対訳メモを削除します。')) return;
    try {
      await api.memos.remove(m.id);
      reload();
    } catch (e) {
      onError(errText(e));
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-lg font-semibold">対訳メモ</h1>
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {shown.length} / {items.length} 件
        </span>
        <div className="flex-1" />
        <select className="input" value={bookFilter} onChange={(e) => setBookFilter(e.target.value)}>
          <option value="">すべての本</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="絞り込み"
          style={{ minWidth: 180 }}
        />
      </div>

      {items.length === 0 && (
        <div className="card p-6 text-center" style={{ color: 'var(--color-muted)' }}>
          まだ対訳メモがありません。本文をドラッグして「翻訳」すると、訳文を対訳メモとして残せます。
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shown.map((m, i) => (
          <div key={m.id} className="card p-3" style={{ background: i % 2 ? 'var(--color-bg)' : undefined }}>
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <button
                className="btn"
                style={{ fontSize: 11 }}
                onClick={() => onOpen(m.book_id)}
                title="この本を開く"
              >
                {m.source_title || '(出典不明)'}
              </button>
              {m.page > 0 && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {m.page}p
                </span>
              )}
              <div className="flex-1" />
              <button
                className="btn"
                style={{ fontSize: 11, color: 'var(--color-danger)' }}
                onClick={() => remove(m)}
              >
                削除
              </button>
            </div>
            <div className="text-sm selectable whitespace-pre-wrap">{m.text}</div>
            <div className="text-sm mt-1 selectable whitespace-pre-wrap" style={{ color: 'var(--color-accent)' }}>
              {m.translation}
            </div>
            {m.memo && (
              <div className="text-sm mt-1 selectable whitespace-pre-wrap" style={{ color: 'var(--color-memo)' }}>
                📝 {m.memo}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
