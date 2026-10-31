import { useEffect, useRef, useState } from 'react';
import type { BookMeta } from '@shared/types';
import { MODEL_OPTIONS, estimateOcrCost } from '@shared/types';
import { api, errText } from '../lib/bridge';
import { openPdf, rasterizePage } from '../lib/rasterize';

// 1回のAPI往復で渡すページ数。多すぎるとIPCに乗る画像が重くなる。
const BATCH = 4;

export function OcrModal({
  book,
  defaultModel,
  onClose,
  onDone,
}: {
  book: BookMeta;
  defaultModel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [model, setModel] = useState(defaultModel);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(book.pages);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [sample, setSample] = useState('');
  const [error, setError] = useState('');
  const cancelRef = useRef(false);

  useEffect(() => () => {
    cancelRef.current = true;
  }, []);

  const lo = Math.max(1, Math.min(from, book.pages));
  const hi = Math.max(lo, Math.min(to, book.pages));
  const count = hi - lo + 1;
  const est = estimateOcrCost(count, model);

  const run = async () => {
    setBusy(true);
    setError('');
    setDone(0);
    cancelRef.current = false;
    try {
      const b64 = await api.books.pdfBytes(book.id);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await openPdf(bytes);

      const results = new Map<number, string>();
      for (let start = lo; start <= hi; start += BATCH) {
        if (cancelRef.current) break;
        const end = Math.min(start + BATCH - 1, hi);

        // ページを画像にする（ここは画面側。canvas が使える）
        const imgs = [];
        for (let n = start; n <= end; n++) {
          if (cancelRef.current) break;
          imgs.push(await rasterizePage(doc, n));
        }
        if (cancelRef.current) break;

        // 書き起こしはメインプロセス側（APIキーを画面に出さないため）
        const texts = await api.ocr.pages(model, imgs);
        for (const t of texts) results.set(t.page, t.text);

        setDone(results.size);
        const last = texts[texts.length - 1];
        if (last) setSample(last.text.slice(0, 80));
      }

      // 中止しても、そこまでに読み終えたページは保存する。
      // 読んだぶんは課金済みなので、捨ててしまわない。
      if (results.size === 0) {
        setBusy(false);
        return;
      }

      // 指定範囲の外は、元の本文があればそのまま残す
      const prev = await api.books.text(book.id);
      const kept = new Map<number, string>();
      for (const chunk of prev.split(/(?=\{\{PAGE\s+\d+\}\})/g)) {
        const m = chunk.match(/^\{\{PAGE\s+(\d+)\}\}/);
        if (m) kept.set(Number(m[1]), chunk.replace(/^\{\{PAGE\s+\d+\}\}\s*/, '').trim());
      }
      for (const [n, t] of results) kept.set(n, t);

      const text = [...kept.keys()]
        .sort((a, c) => a - c)
        .map((n) => `{{PAGE ${n}}}\n${kept.get(n) ?? ''}`)
        .join('\n\n');

      await api.ocr.commit(book.id, text);
      onDone();
      if (cancelRef.current) {
        // 中止のときは、どこまで入ったかを見せてから閉じる
        setError(`中止しました。${results.size} ページぶんは保存しました。`);
        setBusy(false);
        return;
      }
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelRef.current = true;
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="card w-full max-w-lg p-4" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">画像から本文を書き起こす</span>
          {!busy && (
            <button className="btn" style={{ fontSize: 12 }} onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
          紙をスキャンしただけのPDFには文字情報がありません。ページを画像として Claude に読ませ、本文を書き起こします。
          <b>ルビ（振り仮名）は本文に混ぜません。</b>縦書きのページもそのまま読めます。
        </p>

        {!busy && (
          <>
            <div className="mb-3">
              <div className="text-sm font-semibold mb-1">読み取るページ</div>
              <div className="flex items-center gap-2">
                <input
                  className="input tabular-nums"
                  style={{ width: 80, textAlign: 'center' }}
                  value={from}
                  onChange={(e) => setFrom(Number(e.target.value.replace(/\D/g, '')) || 1)}
                />
                <span>〜</span>
                <input
                  className="input tabular-nums"
                  style={{ width: 80, textAlign: 'center' }}
                  value={to}
                  onChange={(e) => setTo(Number(e.target.value.replace(/\D/g, '')) || 1)}
                />
                <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  / 全 {book.pages} ページ（{count} ページを読みます）
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                まず数ページだけ試して、読み取りの質を確かめてから全体を回すのがおすすめです。
              </p>
            </div>

            <div className="mb-3">
              <div className="text-sm font-semibold mb-1">読み取りに使うモデル</div>
              <div className="flex flex-col gap-1">
                {MODEL_OPTIONS.map((m) => {
                  const e = estimateOcrCost(count, m.id);
                  return (
                    <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ocrModel"
                        checked={model === m.id}
                        onChange={() => setModel(m.id)}
                      />
                      <span className="text-sm">
                        {m.label}
                        <span style={{ color: 'var(--color-muted)' }}>
                          {' '}
                          — この範囲で約 {Math.round(e.jpy).toLocaleString()} 円
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                和書の密な縦書きなら Sonnet 以上が無難です。費用は目安で、実際の請求は Anthropic からご本人宛になります。
              </p>
            </div>

            <div
              className="p-2 rounded text-sm mb-3"
              style={{ background: 'var(--color-bg)' }}
            >
              この操作の見積もり: <b>約 {Math.round(est.jpy).toLocaleString()} 円</b>（${est.usd.toFixed(2)}）
            </div>
          </>
        )}

        {busy && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span>
                書き起こし中… {done} / {count} ページ
              </span>
              <span style={{ color: 'var(--color-muted)' }}>
                {Math.round((done / Math.max(1, count)) * 100)}%
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
              <div
                style={{
                  height: '100%',
                  width: `${(done / Math.max(1, count)) * 100}%`,
                  background: 'var(--color-accent)',
                  borderRadius: 3,
                  transition: 'width .3s',
                }}
              />
            </div>
            {sample && (
              <div className="text-xs mt-2 selectable" style={{ color: 'var(--color-muted)' }}>
                直前のページ: {sample}…
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {busy ? (
            <button className="btn" onClick={cancel}>
              中止（ここまでの結果は保存します）
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                閉じる
              </button>
              <button className="btn btn-primary" onClick={run} disabled={count < 1}>
                書き起こしを始める
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
