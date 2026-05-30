import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import KanbanColumn from '../components/KanbanColumn';
import { STATUSES } from '../lib/status';
import { IconArrow } from '../components/icons';

export default function Dashboard() {
  const [cards, setCards] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api('/api/cards'),
      api('/api/mine').then((d) => d.jobs || []).catch(() => []), // mining is optional
    ])
      .then(([cardData, jobData]) => { setCards(cardData); setJobs(jobData); setError(null); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // live polling; faster so mining progress shows up promptly
    return () => clearInterval(t);
  }, [load]);

  // In-flight (and just-failed) mining jobs become non-clickable placeholders in the Mining column.
  const miningCards = jobs
    .filter((j) => j.status === 'mining' || j.status === 'error')
    .map((j) => ({ jobId: j.jobId, mining: true, query: j.query, subreddit: j.subreddit, creator_email: j.creatorEmail, error: j.status === 'error' ? j.error : null }));

  const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const c of cards) (grouped[c.status] || (grouped[c.status] = [])).push(c);
  grouped.mining = miningCards;

  const activeCount = cards.length + miningCards.length;

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Build loop · live</span>
          <h1 className="display">Pipeline</h1>
          <p>{activeCount} card{activeCount === 1 ? '' : 's'} moving from request to shipped.</p>
        </div>
        <Link to="/submit" className="btn btn-accent">Submit a request <IconArrow className="arrow" /></Link>
      </div>

      {loading && <div className="loading"><span className="pulse" /> Loading cards…</div>}
      {error && <div className="error">Failed to load: {error}</div>}

      {!loading && !error && (
        <div className="kanban">
          {STATUSES.map((s) => <KanbanColumn key={s} status={s} cards={grouped[s] || []} />)}
        </div>
      )}
    </div>
  );
}
