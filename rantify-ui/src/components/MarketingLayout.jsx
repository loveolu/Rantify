import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Footer from './Footer';
import { IconArrow } from './icons';

export default function MarketingLayout({ children }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="marketing-shell">
      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="Rantify home">
            <img src="/rantify-logo.png" alt="Rantify" className="brand-logo" />
          </Link>
          <nav className="nav-links">
            <NavLink to="/features">Product</NavLink>
            <NavLink to="/pricing">Pricing</NavLink>
            <NavLink to="/integrations">Integrations</NavLink>
            <NavLink to="/app">Dashboard</NavLink>
          </nav>
          <div className="nav-cta">
            <Link to="/integrations" className="nav-signin">Sign in</Link>
            <Link to="/submit" className="btn btn-accent btn-sm">
              Start free <IconArrow className="arrow" />
            </Link>
          </div>
        </div>
      </header>
      <main className="marketing-main">{children}</main>
      <Footer />
    </div>
  );
}
