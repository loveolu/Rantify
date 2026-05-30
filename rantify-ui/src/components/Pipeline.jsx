const STAGES = [
  { state: 'done',   icon: '✓', name: 'inbox',          meta: 'flaky-ci-detector · 0.86' },
  { state: 'done',   icon: '✓', name: 'ready-for-build', meta: 'spec approved'             },
  { state: 'active', icon: '',  name: 'building',        meta: 'session 0xA4F · branch open' },
  { state: 'queued', icon: '○', name: 'ship',            meta: 'waiting for approval'      },
];

export default function Pipeline() {
  return (
    <div className="pipe-card" role="img" aria-label="Live build pipeline">
      <div className="pipe-head">
        <span className="dots"><i /><i /><i /></span>
        <span className="label">rantify · build loop</span>
      </div>
      <div className="pipe-log">
        {STAGES.map((s) => (
          <div key={s.name} className={`pipe-row ${s.state}`}>
            <span className={`status-icon${s.state === 'active' ? ' spinner-ring' : ''}`}>
              {s.state !== 'active' && s.icon}
            </span>
            <span className="pname">{s.name}</span>
            <span className="pmeta">{s.meta}</span>
          </div>
        ))}
      </div>
      <div className="pipe-footer">
        <div className="pipe-footer-row">
          <span className="dot-sm" />
          <span>1 session running · polling every 30s</span>
        </div>
      </div>
    </div>
  );
}
