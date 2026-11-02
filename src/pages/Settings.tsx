import { useEffect, useState } from 'react';
import type { UpdateState } from '@shared/types';
import type { Settings } from '@shared/types';
import { MODEL_OPTIONS, estimateOcrCost } from '@shared/types';
import { api, errText } from '../lib/bridge';

export function SettingsPage({
  settings,
  onChange,
  onError,
}: {
  settings: Settings | null;
  onChange: (s: Settings) => void;
  onError: (msg: string) => void;
}) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [encAvailable, setEncAvailable] = useState(true);
  const [version, setVersion] = useState('');
  const [upd, setUpd] = useState<UpdateState>({ phase: 'idle', version: '' });

  useEffect(() => {
    api.settings.encryptionAvailable().then(setEncAvailable).catch(() => setEncAvailable(false));
    api.app.version().then(setVersion).catch(() => setVersion(''));
    api.update.state().then(setUpd).catch(() => undefined);
    return api.update.onState(setUpd);
  }, []);

  if (!settings) return <div className="p-4">読み込み中…</div>;

  const saveKey = async () => {
    setSaving(true);
    try {
      onChange(await api.settings.setApiKey(key));
      setKey('');
    } catch (e) {
      onError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!confirm('保存したAPIキーを消します。よろしいですか？')) return;
    try {
      onChange(await api.settings.clearApiKey());
    } catch (e) {
      onError(errText(e));
    }
  };

  const update = async (
    patch: Partial<Pick<Settings, 'model' | 'ocrModel' | 'medicalMode' | 'checkUpdates'>>,
  ) => {
    try {
      onChange(await api.settings.update(patch));
    } catch (e) {
      onError(errText(e));
    }
  };

  return (
    <div className="p-4 max-w-2xl">
      <h1 className="text-lg font-semibold mb-4">設定</h1>

      <section className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">Anthropic APIキー</h2>
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
          辞書引きと翻訳に使います。キーはこのPCの中だけに保存され、Anthropic 以外のどこにも送られません。
          キーの発行は{' '}
          <button
            className="btn"
            style={{ fontSize: 11, padding: '0 6px' }}
            onClick={() => api.app.openExternal('https://console.anthropic.com/settings/keys')}
          >
            Anthropic コンソール
          </button>{' '}
          から行えます。料金は使った分だけご自身に請求されます。
        </p>

        {!encAvailable && (
          <p className="text-sm mb-3" style={{ color: 'var(--color-warn)' }}>
            このPCではOSの暗号化領域が使えないため、キーは平文で保存されます。共用PCではご注意ください。
          </p>
        )}

        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">状態:</span>
          {settings.hasApiKey ? (
            <span style={{ color: 'var(--color-success)' }}>● 設定済み</span>
          ) : (
            <span style={{ color: 'var(--color-danger)' }}>● 未設定</span>
          )}
          {settings.hasApiKey && (
            <button className="btn" style={{ fontSize: 11 }} onClick={clearKey}>
              消す
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary" onClick={saveKey} disabled={!key.trim() || saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">辞書・翻訳に使うモデル</h2>
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
          賢いほど訳は丁寧ですが、料金と待ち時間は増えます。辞書引きを何度も使うなら Haiku が軽快です。
        </p>
        <div className="flex flex-col gap-2">
          {MODEL_OPTIONS.map((m) => (
            <label key={m.id} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="model"
                checked={settings.model === m.id}
                onChange={() => update({ model: m.id })}
                style={{ marginTop: 3 }}
              />
              <span>
                <span className="font-semibold">{m.label}</span>
                <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                  {m.note}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">画像PDFの書き起こしに使うモデル</h2>
        <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
          紙をスキャンしたPDFは、ページを画像として読み取って本文にします。ページ数のぶんだけ呼ぶので、
          辞書・翻訳とは別に選べるようにしています。和書の密な縦書きなら Sonnet 以上が無難です。
          （取り込みのたびに、その本の見積もりを出したうえで選び直せます）
        </p>
        <div className="flex flex-col gap-2">
          {MODEL_OPTIONS.map((m) => {
            const e = estimateOcrCost(300, m.id);
            return (
              <label key={m.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ocrModel"
                  checked={settings.ocrModel === m.id}
                  onChange={() => update({ ocrModel: m.id })}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span className="font-semibold">{m.label}</span>
                  <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                    300ページの本1冊でおよそ {Math.round(e.jpy).toLocaleString()} 円
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">語義の寄せ方</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.medicalMode}
            onChange={(e) => update({ medicalMode: e.target.checked })}
          />
          <span>医学・医療分野の語義を優先する</span>
        </label>
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">更新</h2>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={settings.checkUpdates}
            onChange={(e) => update({ checkUpdates: e.target.checked })}
          />
          <span>起動時に新しい版が出ていないか確かめる</span>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn"
            onClick={() => api.update.check().catch((e) => onError(errText(e)))}
            disabled={upd.phase === 'checking' || upd.phase === 'downloading'}
          >
            今すぐ確認
          </button>
          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
            {upd.phase === 'checking' && '確認しています…'}
            {upd.phase === 'none' && 'お使いの版が最新です。'}
            {upd.phase === 'available' && `新しい版 v${upd.version} があります。`}
            {upd.phase === 'downloading' && `取得中… ${upd.percent ?? 0}%`}
            {upd.phase === 'ready' && `v${upd.version} の準備ができました。`}
            {upd.phase === 'unsupported' && '開発中の実行では確認できません。'}
            {upd.phase === 'error' && (
              <span style={{ color: 'var(--color-danger)' }}>確認に失敗しました: {upd.error}</span>
            )}
          </span>

          {upd.phase === 'available' && (
            <button className="btn btn-primary" onClick={() => api.update.download()}>
              ダウンロード
            </button>
          )}
          {upd.phase === 'ready' && (
            <button className="btn btn-primary" onClick={() => api.update.install()}>
              再起動して適用
            </button>
          )}
        </div>

        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          更新は GitHub の Releases から取得します。署名証明書を付けていないため、
          適用時に Windows の警告が出ることがあります。
        </p>
      </section>

      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        文献蔵デスクトップ版 {version && `v${version}`}
      </p>
    </div>
  );
}
