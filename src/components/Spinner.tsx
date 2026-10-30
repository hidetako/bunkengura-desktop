
interface Props {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  fullscreen?: boolean;
}

export function Spinner({ label, size = 'md', fullscreen }: Props) {
  const dim = size === 'sm' ? 16 : size === 'lg' ? 40 : 24;
  const ring = (
    <span
      aria-label="読み込み中"
      className="bunken-spinner"
      style={{
        width: dim,
        height: dim,
        display: 'inline-block',
        border: `${Math.max(2, dim / 8)}px solid var(--color-border)`,
        borderTopColor: 'var(--color-accent)',
        borderRadius: '50%',
        animation: 'bunken-spin 0.9s linear infinite',
      }}
    />
  );

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      >
        <div
          className="card flex flex-col items-center gap-3 px-6 py-5"
          style={{ minWidth: 200 }}
        >
          {ring}
          {label && (
            <div className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
              {label}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {ring}
      {label && (
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {label}
        </span>
      )}
    </span>
  );
}
