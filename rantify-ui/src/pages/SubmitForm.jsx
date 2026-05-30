import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { IconArrow } from '../components/icons';

export default function SubmitForm() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [subreddit, setSubreddit] = useState('');
  const [creatorEmail, setCreatorEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!query.trim()) { setError('Tell Rantify which company or feature to gather feedback on.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/mine', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          subreddit: subreddit.trim().replace(/^\/?r\//i, '') || undefined,
          creator_email: creatorEmail.trim() || undefined,
        }),
      });
      navigate('/app'); // job runs in the background; it shows up in the Mining column
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="submit-form">
      <div className="page-head" style={{ display: 'block', marginBottom: 24 }}>
        <span className="eyebrow">New feedback mine</span>
        <h1 className="display">Mine real feedback.</h1>
        <p>Name a company or feature. Rantify reads Reddit for what people actually say, then turns it into a buildable implementation spec.</p>
      </div>

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <label>
            Company or feature
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Notion's new AI features, or Spotify shuffle" required />
          </label>

          <label>
            Subreddit <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-3)' }}>(optional — leave blank to search all of Reddit)</span>
            <input type="text" value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="e.g. productivity" />
          </label>

          <label>
            Your email <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-3)' }}>(optional)</span>
            <input type="email" value={creatorEmail} onChange={(e) => setCreatorEmail(e.target.value)} placeholder="you@company.com" />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-foot">
            <button type="submit" className="btn btn-accent" disabled={submitting}>
              {submitting ? 'Starting…' : <>Mine feedback <IconArrow className="arrow" /></>}
            </button>
            <span className="hint">→ mines Reddit, then lands as <b>inbox</b></span>
          </div>
        </form>
      </div>
    </div>
  );
}
