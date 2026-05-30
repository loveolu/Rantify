import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <Link to="/" className="brand" aria-label="Rantify home">
              <img src="/rantify-logo.png" alt="Rantify" className="brand-logo lg" />
            </Link>
            <p>Developer friction, turned into shipped software. Submit the tools you keep requesting — Rantify builds, reviews, and ships them.</p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <Link to="/features">Features</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/app">Dashboard</Link>
            <Link to="/submit">Submit a request</Link>
          </div>
          <div className="footer-col">
            <h4>Connect</h4>
            <Link to="/integrations">Integrations</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Rantify, Inc. All rights reserved.</span>
          <span className="made">built on Box · GitHub · the build loop</span>
        </div>
      </div>
    </footer>
  );
}
