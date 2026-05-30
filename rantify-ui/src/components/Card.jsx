import { useNavigate } from 'react-router-dom';

export default function Card({ fileId, mining, query, subreddit, error, theme, pain_score, creator_email, status, repo_url, pr_url }) {
  const navigate = useNavigate();

  // Feedback-mining placeholder: a job in flight (or just-failed). Not yet a real Box card.
  if (mining) {
    return (
      <div className={`card card-mining${error ? ' card-mining-error' : ''}`}>
        <div className="card-theme">{query}</div>
        <div className="card-meta">
          {subreddit ? <span className="card-email">r/{subreddit}</span> : <span className="card-email">all of Reddit</span>}
          {creator_email && <span className="card-email">{creator_email}</span>}
        </div>
        {error
          ? <span className="card-status status-failed">mining failed</span>
          : <span className="card-status status-mining"><span className="pulse" /> mining…</span>}
        {error && <div className="card-error">{error}</div>}
      </div>
    );
  }

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
