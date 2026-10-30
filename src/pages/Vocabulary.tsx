import { useEffect, useMemo, useState } from 'react';
import type { VocabEntry } from '@shared/types';
import { api, errText } from '../lib/bridge';
import { speakWord } from '../lib/utils';

export function Vocabulary({ onError }: { onError: (msg: string) => void }) {
  const [items, setItems] = useState<VocabEntry[]>([]);
  const [q, setQ] = useState('');

  const reload = () =>
    api.vocab
      .list()
      .then(setItems)
      .catch((e) => onError(errText(e)));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter((v) =>
      [v.word, v.general_meaning, v.medical_meaning, v.source_title].some((s) =>
        (s || '').toLowerCase().includes(k),
      ),
    );
  }, [items, q]);

  const remove = async (v: VocabEntry) => {
    if (!confirm(`「${v.word}」を単語帳から削除します。`)) return;
    try {
      await api.vocab.remove(v.id);
      reload();
    } catch (e) {
      onError(errText(e));
    }
  };

  const exportCsv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = ['単語', '発音', '一般的な意味', '専門的な意味', '例文', '出典文', '出典', '登録日'];
    const rows = shown.map((v) =>
      [
        v.word,
        v.pronunciation,
        v.general_meaning,
        v.medical_meaning,
        v.example,
        v.source_sentence,
        v.source_title,
        v.created_at.slice(0, 10),
      ]
        .map((s) => esc(s ?? ''))
        .join(','),
    );
    // BOM を付けて Excel で文字化けしないようにする
    const blob = new Blob(['﻿' + [head.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `単語帳_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-lg font-semibold">単語帳</h1>
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {shown.length} / {items.length} 語
        </span>
        <div className="flex-1" />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="絞り込み"
          style={{ minWidth: 180 }}
        />
        <button className="btn" onClick={exportCsv} disabled={shown.length === 0}>
          CSV書き出し
        </button>
      </div>

      {items.length === 0 && (
        <div className="card p-6 text-center" style={{ color: 'var(--color-muted)' }}>
          まだ単語がありません。本文中の語をクリックして辞書を引き、「単語帳に追加」で貯まります。
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shown.map((v, i) => (
          <div key={v.id} className="card p-3" style={{ background: i % 2 ? 'var(--color-bg)' : undefined }}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-base">{v.word}</span>
              {v.pronunciation && (
                <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  {v.pronunciation}
                </span>
              )}
              <button className="btn" style={{ fontSize: 11 }} onClick={() => speakWord(v.word)}>
                🔊
              </button>
              <div className="flex-1" />
              <button
                className="btn"
                style={{ fontSize: 11, color: 'var(--color-danger)' }}
                onClick={() => remove(v)}
              >
                削除
              </button>
            </div>
            {v.general_meaning && <div className="text-sm mt-1">{v.general_meaning}</div>}
            {v.medical_meaning && (
              <div className="text-sm mt-1" style={{ color: 'var(--color-accent)' }}>
                {v.medical_meaning}
              </div>
            )}
            {v.example && (
              <div className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                {v.example}
              </div>
            )}
            {v.source_sentence && (
              <div className="text-xs mt-2 selectable" style={{ color: 'var(--color-muted)' }}>
                出典文: {v.source_sentence}
              </div>
            )}
            {v.source_title && (
              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                出典: {v.source_title}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
