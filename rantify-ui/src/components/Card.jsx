import { useNavigate } from 'react-router-dom';

export default function Card({ fileId, theme, pain_score, creator_email, status, repo_url, pr_url }) {
  const navigate = useNavigate();

  return (
    <div className="card" onClick={() => navigate(`/card/${fileId}`)}>
      <div className="card-theme">{theme}</div>
      <div className="card-meta">
        <span className="card-pain">{pain_score != null ? pain_score.toFixed(2) : '—'}</span>
        {creator_email && <span className="card-email">{creator_email}</span>}
      </div>
      {(repo_url || pr_url) && (
        <div className="card-links">
          {repo_url && <a href={repo_url} target="_blank" onClick={e => e.stopPropagation()}>repo</a>}
          {pr_url && <a href={pr_url} target="_blank" onClick={e => e.stopPropagation()}>PR</a>}
        </div>
      )}
      <span className={`card-status status-${status}`}>{status}</span>
    </div>
  );
}
