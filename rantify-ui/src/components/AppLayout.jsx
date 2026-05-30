import { NavLink } from 'react-router-dom';
import { IconKanban, IconMegaphone, IconRoute } from './icons';

const nav = [
  { to: '/app', end: true, label: 'Dashboard', icon: IconKanban },
  { to: '/submit', label: 'New request', icon: IconMegaphone },
  { to: '/integrations', label: 'Integrations', icon: IconRoute },
];

export default function AppLayout({ children }) {
  return (
    <div className="app-shell">
      <aside className="app-side">
        <div className="brand" aria-label="Rantify home">
          <img src="/rantify-logo.png" alt="Rantify" className="brand-logo sm" />
        </div>
        <nav className="app-nav">
          {nav.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon width={18} height={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <nav className="app-nav">
          <NavLink to="/" end>
            <svg {...{ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
              <path d="m9 11-4 4 4 4" /><path d="M5 15h11a4 4 0 0 0 0-8H13" />
            </svg>
            <span>Back to site</span>
          </NavLink>
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-top">
          <span className="eyebrow">Rantify</span>
        </header>
        <main className="app-page">{children}</main>
      </div>
    </div>
  );
}
