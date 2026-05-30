import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { STATUS_LABEL, STATUS_COLOR } from '../lib/status';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const STATUS_ACTIONS = [
  { label: 'Move to ready', status: 'ready-for-build', from: ['inbox'], variant: 'btn-ghost' },
  { label: 'Approve build', status: 'building-approved', from: ['building'], variant: 'btn-ghost' },
  { label: 'Ship it', status: 'completed', from: ['building-approved'], variant: 'btn-accent' },
  { label: 'Mark failed', status: 'failed', from: ['inbox', 'ready-for-build', 'building', 'building-approved'], variant: 'btn-ghost' },
];

export default function CardDetail() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [spec, setSpec] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api(`/api/cards/${fileId}`),
      api(`/api/cards/${fileId}/spec`).catch(() => ({ content: '' })),
    ])
      .then(([cardData, specData]) => { setCard(cardData); setSpec(specData.content); })
      .catch((err) => setError(err.message));
  }, [fileId]);

  async function changeStatus(status) {
    try { await api(`/api/cards/${fileId}`, { method: 'PUT', body: JSON.stringify({ status }) }); navigate(0); }
    catch (err) { alert(`Failed: ${err.message}`); }
  }

  if (error) return <div className="error">{error}</div>;
  if (!card) return <div className="loading"><span className="pulse" /> Loading card…</div>;

  const metaFields = [
    ['Theme', card.theme],
    ['Pain score', card.pain_score != null ? Number(card.pain_score).toFixed(2) : null],
    ['Card ID', card.card_id],
    ['Creator', card.creator_email],
    ['Build session', card.builder_session_id],
    ['Repo', card.repo_url],
    ['Pull request', card.pr_url],
    ['Box task', card.box_task_id],
  ];

  const allowed = STATUS_ACTIONS.filter((a) => a.from.includes(card.status));
  const color = STATUS_COLOR[card.status] || 'var(--st-inbox)';

  return (
    <div className="card-detail">
      <button className="back" onClick={() => navigate('/app')}>← Back to pipeline</button>

      <div className="detail-hero">
        <span className="pill" style={{ background: color }}>{STATUS_LABEL[card.status] || card.status}</span>
      </div>
      <h1>{card.theme || 'Untitled request'}</h1>

      <section className="detail-section">
        <h2>Metadata</h2>
        <div className="meta-grid">
          {metaFields.map(([k, v]) => {
            const isUrl = /repo|request|url/i.test(k) && v;
            return (
              <div className="meta-cell" key={k}>
                <div className="k">{k}</div>
                <div className={`v ${v == null ? 'muted' : ''}`}>
                  {v == null ? '—' : isUrl ? <a href={v} target="_blank" rel="noreferrer">{v} ↗</a> : String(v)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {allowed.length > 0 && (
        <section className="detail-section">
          <h2>Move this card</h2>
          <div className="actions">
            {allowed.map((a) => (
              <button key={a.status} className={`btn ${a.variant}`} onClick={() => changeStatus(a.status)}>{a.label}</button>
            ))}
          </div>
        </section>
      )}

      <section className="detail-section">
        <h2>Spec</h2>
        <pre className="spec-viewer">{spec || 'No spec available.'}</pre>
      </section>

      {card.has_artifacts?.length > 0 && (
        <section className="detail-section">
          <h2>Artifacts</h2>
          <ul className="artifacts">
            {card.has_artifacts.map((name) => (
              <li key={name}>
                <a href={`${BASE}/api/cards/${fileId}/artifacts/${name}`} target="_blank" rel="noreferrer">{name}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
