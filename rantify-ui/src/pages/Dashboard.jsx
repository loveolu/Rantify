import { useState, useEffect } from 'react';
import { api } from '../api';
import KanbanColumn from '../components/KanbanColumn';

const STATUSES = ['inbox', 'ready-for-build', 'building', 'building-approved', 'completed', 'failed'];

export default function Dashboard() {
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/cards')
      .then(data => { setCards(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <div className="loading">Loading cards…</div>;
  if (error) return <div className="error">Failed to load: {error}</div>;

  const grouped = {};
  for (const s of STATUSES) grouped[s] = [];
  for (const c of cards) {
    if (grouped[c.status]) grouped[c.status].push(c);
  }

  return (
    <div className="dashboard">
      <h1>Build Cards</h1>
      <div className="kanban">
        {STATUSES.map(s => (
          <KanbanColumn key={s} status={s} cards={grouped[s]} />
        ))}
      </div>
    </div>
  );
}
