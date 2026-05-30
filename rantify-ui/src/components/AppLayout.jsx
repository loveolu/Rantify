import { NavLink, useLocation } from 'react-router-dom';
import { IconKanban, IconMegaphone, IconRoute } from './icons';

const nav = [
  { to: '/app',          end: true, label: 'Dashboard',    icon: IconKanban },
  { to: '/submit',       end: true, label: 'New request',  icon: IconMegaphone },
  { to: '/integrations', end: true, label: 'Integrations', icon: IconRoute },
];

const CRUMB = {
  '/app':          'Dashboard',
  '/submit':       'New request',
  '/integrations': 'Integrations',
};

export default function AppLayout({ children }) {
  const { pathname } = useLocation();
  const crumb = CRUMB[pathname] || (pathname.startsWith('/card/') ? 'Card detail' : null);

  return (
    <div className="app-shell">
      <aside className="app-side">
        <div className="brand" aria-label="Rantify home">
          <img src="/rantify-logo.png" alt="Rantify" className="brand-logo sm" />
        </div>
        <div className="app-side-divider" />
        <div className="app-side-label">Build loop</div>
        <nav className="app-nav">
          {nav.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon width={17} height={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <div className="app-side-divider" />
        <nav className="app-nav">
          <NavLink to="/" end>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Back to site</span>
          </NavLink>
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-top">
          <div className="breadcrumb">
            <span>Rantify</span>
            {crumb && <><span className="sep">/</span><span className="cur">{crumb}</span></>}
          </div>
          <span className="spacer" />
          <div className="live-badge">
            <span className="pulse-dot" />
            live
          </div>
        </header>
        <main className="app-page">{children}</main>
      </div>
    </div>
  );
}
