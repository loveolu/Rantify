import { useState, useEffect } from 'react';
import { api } from '../api';
import { IconGitHub, IconBox, IconArrow } from '../components/icons';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Build the compact wire target string the backend understands (see auth/targets.mjs).
function buildTarget(kind, org, repo) {
  if (kind === 'org') return org.trim() ? `org:${org.trim()}` : null;
  if (kind === 'repo') return /^[^/\s]+\/[^/\s]+$/.test(repo.trim()) ? `repo:${repo.trim()}` : null;
  return 'personal';
}

function describeTarget(t) {
  if (!t || t === 'personal') return 'Personal account · new repo';
  if (t.startsWith('org:')) return `Org ${t.slice(4)} · new repo`;
  if (t.startsWith('repo:')) return `Existing repo ${t.slice(5)}`;
  return t;
}

export default function OAuthStatus() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState('personal');
  const [org, setOrg] = useState('');
  const [repo, setRepo] = useState('');
  const [savingTarget, setSavingTarget] = useState(null);

  function refresh() {
    return api('/api/auth/status')
      .then((data) => setConnections(data.connections || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  const target = buildTarget(kind, org, repo);
  const targetInvalid = target === null;

  function startOAuth() {
    if (!email.trim() || connecting || targetInvalid) return;
    setConnecting(true);
    const params = new URLSearchParams({ email: email.trim() });
    if (target && target !== 'personal') params.set('target', target);
    window.location.href = `${BACKEND_URL}/auth/github/login?${params}`;
  }

  async function changeTarget(connEmail) {
    const nextRaw = window.prompt(
      'New build target for ' + connEmail + ':\n\n' +
      '  personal            → create a new repo under your account\n' +
      '  org:NAME            → create a new repo under that org\n' +
      '  repo:OWNER/NAME     → open PRs against an existing repo',
      'personal');
    if (nextRaw == null) return;
    setSavingTarget(connEmail);
    try {
      await api('/api/auth/target', { method: 'POST', body: JSON.stringify({ email: connEmail, target: nextRaw.trim() }) });
      await refresh();
    } catch (err) {
      window.alert('Could not update target: ' + err.message);
    } finally {
      setSavingTarget(null);
    }
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

        <div className="oauth-target">
          <label className="field">
            <span>Where should builds go?</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={connecting}>
              <option value="personal">My account — create a new repo</option>
              <option value="org">An organization — create a new repo</option>
              <option value="repo">An existing repo — branch &amp; open a PR</option>
            </select>
          </label>
          <p className="field-hint">
            GitHub's authorization screen grants Rantify access to your repositories (and any orgs you approve) — it
            won't ask you to pick a repo. This setting is what tells Rantify where to push afterward.
          </p>
          {kind === 'org' && (
            <input type="text" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="organization (e.g. acme)" disabled={connecting} />
          )}
          {kind === 'repo' && (
            <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo (e.g. acme/flaky-helper)" disabled={connecting} />
          )}
        </div>

        <div className="oauth-connect">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" disabled={connecting} />
          <button className="btn btn-accent" onClick={startOAuth} disabled={!email.trim() || connecting || targetInvalid}>
            {connecting ? <><span className="spinner" /> Redirecting…</> : <>Connect GitHub <IconArrow className="arrow" /></>}
          </button>
        </div>
        {targetInvalid && <p className="field-error">Enter a valid {kind === 'repo' ? 'owner/repo' : 'organization name'}.</p>}
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
                      <span className="conn-login">@{c.login} · {describeTarget(c.target)}</span>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => changeTarget(c.email)} disabled={savingTarget === c.email}>
                      {savingTarget === c.email ? 'Saving…' : 'Change target'}
                    </button>
                    <span className="conn-status connected">Connected</span>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  );
}
