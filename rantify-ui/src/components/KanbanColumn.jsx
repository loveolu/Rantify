import Card from './Card';

const STATUS_LABELS = {
  inbox: 'Inbox',
  'ready-for-build': 'Ready',
  building: 'Building',
  'building-approved': 'Approved',
  completed: 'Completed',
  failed: 'Failed',
};

export default function KanbanColumn({ status, cards }) {
  return (
    <div className="column">
      <h2 className="column-title">{STATUS_LABELS[status] || status} <span className="count">{cards.length}</span></h2>
      <div className="column-cards">
        {cards.map(c => (
          <Card key={c.fileId} {...c} />
        ))}
        {cards.length === 0 && <p className="empty">No cards</p>}
      </div>
    </div>
  );
}
