import { useCallback, useEffect, useRef } from 'react';

// ペインの境目。マウスでもタッチでも引けるようにする（iPad等での操作を想定）。
export function Splitter({
  vertical,
  onDrag,
}: {
  /** true なら縦の仕切り（左右に分ける）。false なら横の仕切り（上下に分ける） */
  vertical: boolean;
  /** 画面座標の変化量を渡す。受け手が幅や高さに反映する */
  onDrag: (deltaPx: number) => void;
}) {
  const last = useRef<number | null>(null);

  const move = useCallback(
    (pos: number) => {
      if (last.current === null) return;
      onDrag(pos - last.current);
      last.current = pos;
    },
    [onDrag],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => move(vertical ? e.clientX : e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) move(vertical ? t.clientX : t.clientY);
    };
    const stop = () => {
      last.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stop);
    };
  }, [move, vertical]);

  const start = (pos: number) => {
    last.current = pos;
    // ドラッグ中に本文が選択されてしまうのを防ぐ
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      title="ドラッグで幅を変える"
      onMouseDown={(e) => start(vertical ? e.clientX : e.clientY)}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) start(vertical ? t.clientX : t.clientY);
      }}
      style={{
        flexShrink: 0,
        background: 'var(--color-border)',
        cursor: vertical ? 'col-resize' : 'row-resize',
        // 指で掴める太さを確保しつつ、見た目は細くする
        ...(vertical ? { width: 6 } : { height: 6 }),
        touchAction: 'none',
      }}
    />
  );
}
