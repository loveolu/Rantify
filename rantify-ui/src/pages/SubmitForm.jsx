import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function SubmitForm() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState('');
  const [description, setDescription] = useState('');
  const [painScore, setPainScore] = useState(0.5);
  const [creatorEmail, setCreatorEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!theme.trim()) { setError('Theme is required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const ref = await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ theme: theme.trim(), description, pain_score: painScore, creator_email: creatorEmail.trim() || undefined }),
      });
      navigate(`/card/${ref.fileId}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="submit-form">
      <h1>Submit a Dev Tool Idea</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Theme <input value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. testing-ci" required />
        </label>
        <label>
          Description <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="Describe the pain point…" />
        </label>
        <label>
          Pain Score: <strong>{painScore.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.01" value={painScore} onChange={e => setPainScore(Number(e.target.value))} />
        </label>
        <label>
          Your Email <input type="email" value={creatorEmail} onChange={e => setCreatorEmail(e.target.value)} placeholder="alice@example.com" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Idea'}</button>
      </form>
    </div>
  );
}
