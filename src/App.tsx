import { useCallback, useEffect, useState } from 'react';
import type { BookMeta, Settings } from '@shared/types';
import { api, errText } from './lib/bridge';
import { Library } from './pages/Library';
import { Reader } from './pages/Reader';
import { Vocabulary } from './pages/Vocabulary';
import { Memos } from './pages/Memos';
import { SettingsPage } from './pages/Settings';
import { UpdateBanner } from './components/UpdateBanner';

type View =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }
  | { name: 'vocabulary' }
  | { name: 'memos' }
  | { name: 'settings' };

const THEMES = [
  { id: '', label: 'ノーマル' },
  { id: 'theme-gray', label: 'グレー' },
  { id: 'theme-beige', label: 'ベージュ' },
  { id: 'dark', label: 'ナイト' },
];

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('bunkengura.theme') ?? '');
  const [error, setError] = useState('');

  // テーマは <html> のクラスで切り替える（CSS変数を差し替える仕組み）
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('theme-gray', 'theme-beige', 'dark');
    if (theme) el.classList.add(theme);
    try {
      localStorage.setItem('bunkengura.theme', theme);
    } catch {
      /* 保存できなくても表示には影響しない */
    }
  }, [theme]);

  const reloadBooks = useCallback(async () => {
    try {
      setBooks(await api.books.list());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    reloadBooks();
    api.settings.get().then(setSettings).catch((e) => setError(errText(e)));
  }, [reloadBooks]);

  const openBook = (bookId: string) => setView({ name: 'reader', bookId });

  // リーダーは画面全体を使うので、共通のナビゲーションを出さない
  if (view.name === 'reader') {
    const book = books.find((b) => b.id === view.bookId);
    if (!book) {
      return (
        <div className="p-6">
          <p>本が見つかりませんでした。</p>
          <button className="btn mt-3" onClick={() => setView({ name: 'library' })}>
            ← 本棚へ戻る
          </button>
        </div>
      );
    }
    return (
      <Reader
        book={book}
        hasApiKey={settings?.hasApiKey ?? false}
        onBack={() => {
          reloadBooks();
          setView({ name: 'library' });
        }}
        onOpenSettings={() => setView({ name: 'settings' })}
      />
    );
  }

  const navBtn = (name: View['name'], label: string) => (
    <button
      key={name}
      className={view.name === name ? 'btn btn-primary' : 'btn'}
      onClick={() => setView({ name } as View)}
    >
      {label}
    </button>
  );

  return (
    <div className="h-screen flex flex-col">
      <header
        className="flex items-center gap-2 px-4 py-2 border-b flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
      >
        <span className="font-semibold mr-2">蔵 文献蔵</span>
        {navBtn('library', '本棚')}
        {navBtn('vocabulary', '単語帳')}
        {navBtn('memos', '対訳メモ')}
        <div className="flex-1" />
        <div className="flex items-center gap-1" title="配色">
          {THEMES.map((t) => (
            <button
              key={t.id || 'normal'}
              className={theme === t.id ? 'btn btn-primary' : 'btn'}
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {navBtn('settings', '設定')}
      </header>

      <UpdateBanner />

      {error && (
        <div
          className="px-4 py-2 text-sm flex items-center justify-between"
          style={{ background: 'rgba(185,28,28,0.12)', color: 'var(--color-danger)' }}
        >
          <span>{error}</span>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setError('')}>
            閉じる
          </button>
        </div>
      )}

      {!settings?.hasApiKey && view.name !== 'settings' && (
        <div
          className="px-4 py-2 text-sm flex items-center justify-between"
          style={{ background: 'rgba(133,77,14,0.12)', color: 'var(--color-warn)' }}
        >
          <span>
            APIキーが未設定です。辞書引き・翻訳を使うには、設定画面で Anthropic のAPIキーを入れてください。
            （本を読む・マーカー・単語帳の手入力はキー無しでも使えます）
          </span>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setView({ name: 'settings' })}>
            設定へ
          </button>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        {view.name === 'library' && (
          <Library
            books={books}
            ocrModel={settings?.ocrModel ?? 'claude-sonnet-5-5'}
            onReload={reloadBooks}
            onOpen={openBook}
            onError={setError}
          />
        )}
        {view.name === 'vocabulary' && <Vocabulary onError={setError} />}
        {view.name === 'memos' && <Memos books={books} onOpen={openBook} onError={setError} />}
        {view.name === 'settings' && (
          <SettingsPage settings={settings} onChange={setSettings} onError={setError} />
        )}
      </main>
    </div>
  );
}
