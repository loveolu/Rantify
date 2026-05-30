import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, moveCard } from '../api';
import KanbanColumn from '../components/KanbanColumn';
import { STATUSES } from '../lib/status';
import { IconArrow } from '../components/icons';

export default function Dashboard() {
  const [cards, setCards] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moveError, setMoveError] = useState(null);
  const movingRef = useRef(false);

  useEffect(() => {
    if (!moveError) return;
    const t = setTimeout(() => setMoveError(null), 5000);
    return () => clearTimeout(t);
  }, [moveError]);

  const load = useCallback(() => {
    Promise.all([
      api('/api/cards'),
      api('/api/mine').then((d) => d.jobs || []).catch(() => []),
    ])
      .then(([cardData, jobData]) => {
        if (!movingRef.current) {
          setCards(cardData);
          setError(null);
        }
        setJobs(jobData);
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const miningCards = jobs
    .filter((j) => j.status === 'mining' || j.status === 'error')
    .map((j) => ({ jobId: j.jobId, mining: true, query: j.query, subreddit: j.subreddit, creator_email: j.creatorEmail, error: j.status === 'error' ? j.error : null }));

  const handleMove = useCallback((fileId, newStatus, oldStatus) => {
    movingRef.current = true;
    setCards((prev) => prev.map((c) => c.fileId === fileId ? { ...c, status: newStatus } : c));
    setMoveError(null);

    moveCard(fileId, newStatus)
      .catch((err) => {
        setCards((prev) => prev.map((c) => c.fileId === fileId ? { ...c, status: oldStatus } : c));
        setMoveError(`Failed to move card: ${err.message}`);
      })
      .finally(() => { movingRef.current = false; });
  }, []);

  const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const c of cards) (grouped[c.status] || (grouped[c.status] = [])).push(c);
  grouped.mining = miningCards;

  // A finished mine writes its card to Box immediately, but Box metadata search indexes it with
  // a lag — so surface completed jobs as real (clickable) Inbox cards until /api/cards catches up.
  const knownFileIds = new Set(cards.map((c) => c.fileId));
  const freshInbox = jobs
    .filter((j) => j.status === 'done' && j.fileId && !knownFileIds.has(j.fileId))
    .map((j) => ({ fileId: j.fileId, theme: j.query, status: 'inbox', creator_email: j.creatorEmail, pain_score: null }));
  grouped.inbox = [...freshInbox, ...grouped.inbox];

  const activeCount = cards.length + freshInbox.length + miningCards.length;

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
      {moveError && <div className="error" role="alert">{moveError}</div>}

      {!loading && !error && (
        <div className="kanban">
          {STATUSES.map((s) => (
            <KanbanColumn key={s} status={s} cards={grouped[s] || []} onMove={handleMove} />
          ))}
        </div>
      )}
    </div>
  );
}
