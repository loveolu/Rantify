import { Link } from 'react-router-dom';
import { IconArrow } from '../components/icons';

export default function Pricing() {
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="container">
        <div className="cta">
          <span className="eyebrow">Pricing</span>
          <h2 className="display">Start with a single request.</h2>
          <p>Free to begin. No credit card. Your first tool could ship today.</p>
          <div className="cta-actions">
            <Link to="/submit" className="btn btn-accent btn-lg">Get started <IconArrow className="arrow" /></Link>
            <Link to="/app" className="btn btn-ghost btn-lg">Open dashboard</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
