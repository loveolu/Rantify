import { useNavigate } from 'react-router-dom';

const STATUS_COLORS = {
  inbox: '#6b7280',
  'ready-for-build': '#3b82f6',
  building: '#f59e0b',
  'building-approved': '#8b5cf6',
  completed: '#10b981',
  failed: '#ef4444',
};

export default function Card({ fileId, theme, pain_score, creator_email, status, repo_url, pr_url }) {
  const navigate = useNavigate();

  return (
    <div className="card" onClick={() => navigate(`/card/${fileId}`)}>
      <div className="card-theme">{theme}</div>
      <div className="card-meta">
        <span className="card-pain" title="Pain score">{pain_score != null ? pain_score.toFixed(2) : '—'}</span>
        {creator_email && <span className="card-email">{creator_email}</span>}
      </div>
      {(repo_url || pr_url) && (
        <div className="card-links">
          {repo_url && <a href={repo_url} target="_blank" onClick={e => e.stopPropagation()}>repo</a>}
          {pr_url && <a href={pr_url} target="_blank" onClick={e => e.stopPropagation()}>PR</a>}
        </div>
      )}
      <span className="card-status" style={{ background: STATUS_COLORS[status] || '#6b7280' }}>{status}</span>
    </div>
  );
}
