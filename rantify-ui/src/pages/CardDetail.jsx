import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const STATUS_ACTIONS = [
  { label: 'Ready for build', status: 'ready-for-build', from: ['inbox'] },
  { label: 'Building approved', status: 'building-approved', from: ['building'] },
  { label: 'Completed', status: 'completed', from: ['building-approved'] },
  { label: 'Fail', status: 'failed', from: ['inbox', 'ready-for-build', 'building', 'building-approved'] },
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
      .catch(err => setError(err.message));
  }, [fileId]);

  async function changeStatus(status) {
    try { await api(`/api/cards/${fileId}`, { method: 'PUT', body: JSON.stringify({ status }) }); navigate(0); }
    catch (err) { alert(`Failed: ${err.message}`); }
  }

  if (error) return <div className="error">{error}</div>;
  if (!card) return <div className="loading">Loading card…</div>;

  const metaFields = [
    ['Status', card.status],
    ['Theme', card.theme],
    ['Pain Score', card.pain_score],
    ['Card ID', card.card_id],
    ['Creator Email', card.creator_email],
    ['Session ID', card.builder_session_id],
    ['Repo URL', card.repo_url],
    ['PR URL', card.pr_url],
    ['Box Task ID', card.box_task_id],
  ];

  const allowedActions = STATUS_ACTIONS.filter(a => a.from.includes(card.status));

  return (
    <div className="card-detail">
      <button className="back" onClick={() => navigate('/')}>← Back</button>
      <h1>{card.theme}</h1>

      <section className="detail-section">
        <h2>Metadata</h2>
        <table className="meta-table">
          <tbody>
            {metaFields.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v != null ? (k.includes('URL') ? <a href={v} target="_blank">{v}</a> : String(v)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {allowedActions.length > 0 && (
        <section className="detail-section">
          <h2>Actions</h2>
          <div className="actions">
            {allowedActions.map(a => (
              <button key={a.status} className={`btn btn-${a.status}`} onClick={() => changeStatus(a.status)}>
                {a.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="detail-section">
        <h2>Spec</h2>
        <pre className="spec-viewer">{spec}</pre>
      </section>

      {card.has_artifacts?.length > 0 && (
        <section className="detail-section">
          <h2>Artifacts</h2>
          <ul className="artifacts">
            {card.has_artifacts.map(name => (
              <li key={name}><a href={`/api/cards/${fileId}/artifacts/${name}`} target="_blank">{name}</a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
