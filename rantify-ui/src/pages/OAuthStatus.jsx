import { useState, useEffect } from 'react';
import { api } from '../api';
import { IconGitHub, IconBox, IconArrow } from '../components/icons';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function OAuthStatus() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    api('/api/auth/status')
      .then((data) => setConnections(data.connections || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function startOAuth() {
    if (!email.trim() || connecting) return;
    setConnecting(true);
    window.location.href = `${BACKEND_URL}/auth/github/login?email=${encodeURIComponent(email.trim())}`;
  }

  return (
    <div className="oauth-page">
      <div className="page-head" style={{ display: 'block', marginBottom: 24 }}>
        <span className="eyebrow">Integrations</span>
        <h1 className="display">Connect your stack.</h1>
        <p>Rantify ships to GitHub and stores everything in Box. Link an account to let the build loop open pull requests on your behalf.</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="gh"><IconGitHub /></span>
          <h2>GitHub</h2>
        </div>
        <p className="sub">Authorize Rantify to branch, push, and open PRs. Scoped per developer — revoke anytime from GitHub.</p>
        <div className="oauth-connect">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" disabled={connecting} />
          <button className="btn btn-accent" onClick={startOAuth} disabled={!email.trim() || connecting}>
            {connecting ? <><span className="spinner" /> Redirecting…</> : <>Connect GitHub <IconArrow className="arrow" /></>}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="gh" style={{ background: 'var(--accent)' }}><IconBox width={22} height={22} /></span>
          <h2>Box content</h2>
        </div>
        <p className="sub">Specs, build artifacts, and logs are governed in a structured Box folder tree — connected at the enterprise level.</p>
        <span className="conn-status connected" style={{ marginLeft: 0 }}>Enterprise connected</span>
      </div>

      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: 18 }}>Connected developers</h2></div>
        {loading
          ? <div className="loading"><span className="pulse" /> Loading connected accounts…</div>
          : connections.length === 0
            ? <div className="empty-state">No GitHub accounts connected yet. Add the first one above.</div>
            : (
              <ul className="connections">
                {connections.map((c) => (
                  <li key={c.email}>
                    <span className="conn-avatar">{(c.login || c.email || '?')[0].toUpperCase()}</span>
                    <span>
                      <span className="conn-email">{c.email}</span><br />
                      <span className="conn-login">@{c.login}</span>
                    </span>
                    <span className="conn-status connected">Connected</span>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  );
}
