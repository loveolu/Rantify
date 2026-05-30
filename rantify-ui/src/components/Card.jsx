import { useNavigate } from 'react-router-dom';
import { STATUS_COLOR, DRAGGABLE_STATUSES } from '../lib/status';

export default function Card({ fileId, mining, query, subreddit, error, theme, pain_score, creator_email, status, repo_url, pr_url }) {
  const navigate = useNavigate();
  const color = STATUS_COLOR[status] || 'var(--st-inbox)';
  const pain = pain_score != null ? Math.max(0, Math.min(1, Number(pain_score))) : null;
  const isDraggable = DRAGGABLE_STATUSES.indexOf(status) < DRAGGABLE_STATUSES.length - 1;

  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ fileId, status, theme: theme || 'Untitled' }));
  }

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
    <article
      className="card"
      style={{ '--card-color': color }}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onClick={() => navigate(`/card/${fileId}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/card/${fileId}`)}
    >
      <div className="card-theme">{theme || 'Untitled'}</div>
      <div className="card-meta">
        {pain != null && (
          <span className="card-pain" title={`Pain score: ${pain.toFixed(2)}`}>
            <span className="pain-bar"><span className="pain-fill" style={{ width: `${pain * 100}%` }} /></span>
            {pain.toFixed(2)}
          </span>
        )}
        {creator_email && <span className="card-email" title={creator_email}>{creator_email}</span>}
      </div>
      {(repo_url || pr_url) && (
        <div className="card-links">
          {repo_url && <a href={repo_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>repo ↗</a>}
          {pr_url && <a href={pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PR ↗</a>}
        </div>
      )}
    </article>
  );
}
