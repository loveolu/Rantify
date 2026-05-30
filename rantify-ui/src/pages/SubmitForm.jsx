import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { IconArrow } from '../components/icons';

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
    if (!theme.trim()) { setError('Give your request a theme so the loop can route it.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const ref = await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({
          theme: theme.trim(), description, pain_score: painScore,
          creator_email: creatorEmail.trim() || undefined,
        }),
      });
      navigate(`/card/${ref.fileId}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const painLabel = painScore < 0.34 ? 'mild annoyance' : painScore < 0.67 ? 'real friction' : 'major pain';

  return (
    <div className="submit-form">
      <div className="page-head" style={{ display: 'block', marginBottom: 24 }}>
        <span className="eyebrow">New build card</span>
        <h1 className="display">Request a feature.</h1>
        <p>Describe the tool you wish existed. One good sentence is enough — Rantify turns it into a buildable spec.</p>
      </div>

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <label>
            Theme
            <input type="text" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. flaky-ci-detector" required />
          </label>

          <label>
            What’s the pain?
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Our CI flakes a few times a day and people just re-run it. I want something that quarantines flaky tests automatically…" />
          </label>

          <label>
            Pain score
            <div className="range-row">
              <input type="range" min="0" max="1" step="0.01" value={painScore} onChange={(e) => setPainScore(Number(e.target.value))} />
              <span className="range-val">{painScore.toFixed(2)}</span>
            </div>
            <div className="range-tags"><span>mild</span><span>{painLabel}</span><span>severe</span></div>
          </label>

          <label>
            Your email <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-3)' }}>(optional)</span>
            <input type="email" value={creatorEmail} onChange={(e) => setCreatorEmail(e.target.value)} placeholder="you@company.com" />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-foot">
            <button type="submit" className="btn btn-accent" disabled={submitting}>
              {submitting ? 'Submitting…' : <>Submit request <IconArrow className="arrow" /></>}
            </button>
            <span className="hint">→ enters the pipeline as <b>inbox</b></span>
          </div>
        </form>
      </div>
    </div>
  );
}
