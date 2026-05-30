import { useState } from 'react';
import Card from './Card';
import { STATUS_COLOR, isForwardMove } from '../lib/status';

const STATUS_LABELS = {
  mining: 'Mining',
  inbox: 'Inbox',
  'ready-for-build': 'Ready',
  building: 'Building',
  'building-approved': 'Approved',
  completed: 'Completed',
  failed: 'Failed',
};

export default function KanbanColumn({ status, cards, onMove }) {
  const [dragOver, setDragOver] = useState(false);
  const color = STATUS_COLOR[status] || 'var(--text-3)';

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    const { fileId, status: fromStatus, theme } = payload;
    if (!isForwardMove(fromStatus, status)) return;
    const label = (s) => STATUS_LABELS[s] || s;
    const confirmed = window.confirm(
      `Move "${theme}" from ${label(fromStatus)} → ${label(status)}?\n\nThis will move the Box folder.`
    );
    if (!confirmed) return;
    onMove(fileId, status, fromStatus);
  }

  return (
    <section
      className={`column${dragOver ? ' column-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="column-title">
        <span className="label-row">
          <span className="status-dot" style={{ background: color }} />
          {STATUS_LABELS[status] || status}
        </span>
        <span className="count">{cards.length}</span>
      </div>
      <div className="column-cards">
        {cards.map((c) => <Card key={c.fileId || c.jobId} {...c} />)}
        {cards.length === 0 && <p className="empty">No cards</p>}
      </div>
    </section>
  );
}
