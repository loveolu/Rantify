import { Link } from 'react-router-dom';
import { IconArrow } from '../components/icons';

export default function Features() {
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="container">
        <div className="cta">
          <span className="eyebrow">Product</span>
          <h2 className="display">See the build loop in action.</h2>
          <p>Open the live dashboard and watch requests flow through the pipeline — from capture to shipped.</p>
          <div className="cta-actions">
            <Link to="/app" className="btn btn-accent btn-lg">Open dashboard <IconArrow className="arrow" /></Link>
            <Link to="/submit" className="btn btn-ghost btn-lg">Submit a request</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
