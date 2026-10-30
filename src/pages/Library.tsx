import { useState } from 'react';
import type { BookMeta } from '@shared/types';
import { api, errText } from '../lib/bridge';
import { Spinner } from '../components/Spinner';

export function Library({
  books,
  onReload,
  onOpen,
  onError,
}: {
  books: BookMeta[];
  onReload: () => void;
  onOpen: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', author: '' });

  const importPdf = async () => {
    setBusy(true);
    try {
      const added = await api.books.pickAndImport();
      onReload();
      // テキスト層の無いPDF（紙のスキャンなど）は本文が取れない。黙って空の本が増えると
      // 原因が分からないので、その場で知らせる。
      const empty = added.filter((b) => b.pages === 0);
      if (empty.length > 0) {
        onError(
          `次のPDFから本文を取り出せませんでした（文字情報を持たないスキャンPDFの可能性があります）: ` +
            empty.map((b) => b.title).join('、'),
        );
      }
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (b: BookMeta) => {
    setEditing(b.id);
    setDraft({ title: b.title, author: b.author });
  };

  const saveEdit = async (id: string) => {
    try {
      await api.books.update(id, { title: draft.title.trim(), author: draft.author.trim() });
      setEditing(null);
      onReload();
    } catch (e) {
      onError(errText(e));
    }
  };

  const remove = async (b: BookMeta) => {
    if (!confirm(`「${b.title}」を削除します。\nこの本に付けたマーカーと対訳メモも消えます。よろしいですか？`)) return;
    try {
      await api.books.remove(b.id);
      onReload();
    } catch (e) {
      onError(errText(e));
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-lg font-semibold">本棚</h1>
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {books.length} 冊
        </span>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={importPdf} disabled={busy}>
          {busy ? '取り込み中…' : '＋ PDFを取り込む'}
        </button>
      </div>

      {busy && (
        <div className="mb-4">
          <Spinner label="PDFからテキストを抽出しています" />
        </div>
      )}

      {books.length === 0 && !busy && (
        <div className="card p-6 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="mb-2">まだ本がありません。</p>
          <p className="text-sm">
            「＋ PDFを取り込む」から、お手元のPDFを選んでください。文字情報を持つPDF（OCR済みを含む）に対応しています。
          </p>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {books.map((b) => (
          <div key={b.id} className="card p-3 flex flex-col gap-2">
            {editing === b.id ? (
              <>
                <input
                  className="input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="書名"
                />
                <input
                  className="input"
                  value={draft.author}
                  onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))}
                  placeholder="著者"
                />
                <div className="flex gap-1 justify-end">
                  <button className="btn" onClick={() => setEditing(null)}>
                    やめる
                  </button>
                  <button className="btn btn-primary" onClick={() => saveEdit(b.id)}>
                    保存
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  className="text-left font-semibold leading-snug"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}
                  onClick={() => onOpen(b.id)}
                  title="開いて読む"
                >
                  {b.title}
                </button>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {b.author && <div>{b.author}</div>}
                  <div>
                    {b.pages} ページ・{b.kind}
                    {b.last_page > 0 && ` ・しおり ${b.last_page}p`}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button className="btn btn-primary" onClick={() => onOpen(b.id)}>
                    読む
                  </button>
                  <button className="btn" onClick={() => startEdit(b)}>
                    書名を直す
                  </button>
                  <button
                    className="btn"
                    onClick={() => api.books.openPdf(b.id).catch((e) => onError(errText(e)))}
                    title="元のPDFを既定のビューアで開く"
                  >
                    PDF
                  </button>
                  <button className="btn" style={{ color: 'var(--color-danger)' }} onClick={() => remove(b)}>
                    削除
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
