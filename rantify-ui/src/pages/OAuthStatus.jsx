import { useState, useEffect } from 'react';
import { api } from '../api';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function OAuthStatus() {
  const [connections, setConnections] = useState([]);
  const [email, setEmail] = useState('');

  useEffect(() => {
    api('/api/auth/status')
      .then(data => setConnections(data.connections || []))
      .catch(() => {});
  }, []);

  function startOAuth() {
    if (!email.trim()) return;
    window.location.href = `${BACKEND_URL}/auth/github/login?email=${encodeURIComponent(email.trim())}`;
  }

  return (
    <div className="oauth-page">
      <h1>GitHub OAuth</h1>

      <section className="detail-section">
        <h2>Connect a GitHub account</h2>
        <div className="oauth-connect">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          <button onClick={startOAuth} disabled={!email.trim()}>Connect GitHub</button>
        </div>
      </section>

      <section className="detail-section">
        <h2>Connected accounts</h2>
        {connections.length === 0 && <p className="empty">No connections yet</p>}
        <ul className="connections">
          {connections.map(c => (
            <li key={c.email}>
              <span className="conn-email">{c.email}</span>
              <span className="conn-login">{c.login}</span>
              <span className="conn-status connected">Connected</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
