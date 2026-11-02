import { useEffect, useState } from 'react';
import type { UpdateState } from '@shared/types';
import { api } from '../lib/bridge';

// 新しい版が出ているときに画面上部へ出す帯。
// 取得は利用者が押してから始める（95MBあるので黙って落とさない）。
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle', version: '' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.update.state().then(setState).catch(() => undefined);
    return api.update.onState((s) => {
      setState(s);
      // 状態が進んだら、閉じたままにせずまた出す
      if (s.phase === 'available' || s.phase === 'ready') setDismissed(false);
    });
  }, []);

  // 出すのは「新しい版がある」「取得中」「適用できる」のときだけ。
  // 最新だった・確認中・開発中・失敗は、設定画面でだけ分かればよい。
  const show =
    !dismissed && (state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready');
  if (!show) return null;

  const bg =
    state.phase === 'ready' ? 'rgba(22,101,52,0.12)' : 'rgba(184,148,90,0.16)';
  const fg = state.phase === 'ready' ? 'var(--color-success)' : 'var(--color-accent)';

  return (
    <div
      className="px-4 py-2 text-sm flex items-center gap-2 flex-wrap"
      style={{ background: bg, color: fg }}
    >
      {state.phase === 'available' && (
        <>
          <span>新しい版 v{state.version} が出ています。</span>
          <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => api.update.download()}>
            ダウンロード
          </button>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setDismissed(true)}>
            あとで
          </button>
        </>
      )}

      {state.phase === 'downloading' && (
        <>
          <span>v{state.version} を取得しています… {state.percent ?? 0}%</span>
          <div
            style={{ flex: 1, minWidth: 120, height: 6, background: 'var(--color-border)', borderRadius: 3 }}
          >
            <div
              style={{
                height: '100%',
                width: `${state.percent ?? 0}%`,
                background: 'var(--color-accent)',
                borderRadius: 3,
                transition: 'width .3s',
              }}
            />
          </div>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <span>v{state.version} の準備ができました。再起動すると新しい版になります。</span>
          <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => api.update.install()}>
            再起動して適用
          </button>
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setDismissed(true)}>
            次に終了したときでよい
          </button>
        </>
      )}
    </div>
  );
}
