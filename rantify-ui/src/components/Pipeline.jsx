/** Animated "live pipeline" card — the recurring Rantify motif. */
const STAGES = [
  { name: 'Inbox', meta: 'flaky-ci-detector', color: 'var(--st-inbox)', state: 'done' },
  { name: 'Ready for build', meta: 'spec approved', color: 'var(--st-ready)', state: 'done' },
  { name: 'Building', meta: 'session 0xA4F', color: 'var(--st-building)', state: 'active' },
  { name: 'Shipped', meta: 'PR #218', color: 'var(--st-done)', state: 'queued' },
];

export default function Pipeline() {
  return (
    <div className="pipe-card">
      <div className="pipe-head">
        <span className="dots"><i /><i /><i /></span>
        <span className="label">live · build loop</span>
      </div>
      <div className="pipe-flow">
        {STAGES.map((s) => (
          <div key={s.name} className={`pipe-stage ${s.state === 'active' ? 'active' : ''}`}>
            <span className="bead" style={{ background: s.color }} />
            <span className="pname">{s.name}</span>
            {s.state === 'active'
              ? <span className="spin" />
              : <span className="pmeta">{s.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
