import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import KanbanColumn from '../components/KanbanColumn';
import { STATUSES } from '../lib/status';
import { IconArrow } from '../components/icons';

export default function Dashboard() {
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api('/api/cards')
      .then((data) => { setCards(data); setError(null); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live polling, matches the build loop
    return () => clearInterval(t);
  }, [load]);

  const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const c of cards) (grouped[c.status] || (grouped[c.status] = [])).push(c);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Build loop · live</span>
          <h1 className="display">Pipeline</h1>
          <p>{cards.length} card{cards.length === 1 ? '' : 's'} moving from request to shipped.</p>
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
