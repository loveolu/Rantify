import { Link } from 'react-router-dom';
import Pipeline from '../components/Pipeline';
import Reveal from '../components/Reveal';
import { IconArrow } from '../components/icons';

const STEPS = [
  { n: '01', c: 'var(--st-inbox)', t: 'Capture', d: 'Submit a feature request with one sentence and a pain score.' },
  { n: '02', c: 'var(--st-ready)', t: 'Spec', d: 'Rantify drafts a build spec and routes it to Ready.' },
  { n: '03', c: 'var(--st-building)', t: 'Build', d: 'An autonomous session branches, writes the tool, and pushes a PR.' },
  { n: '04', c: 'var(--st-done)', t: 'Ship', d: 'Reviewed, approved, merged. The request becomes a tool you can use.' },
];

export default function Landing() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="stagger">
            <div className="hero-eyebrow">
              <span className="dot" />
              <span className="eyebrow">Autonomous dev-tool factory</span>
            </div>
            <h1 className="display">
              Developer friction,<br />
              turned into <em>shipped</em><br />
              <span className="accent-text">software.</span>
            </h1>
            <p className="hero-sub">
              Rantify captures the tools you keep <strong>requesting</strong> and runs
              them through an automated build loop — spec, build, review, ship — until the
              friction is gone.
            </p>
            <div className="hero-actions">
              <Link to="/submit" className="btn btn-accent btn-lg">
                Submit a request <IconArrow className="arrow" />
              </Link>
              <Link to="/app" className="btn btn-ghost btn-lg">See the pipeline</Link>
            </div>
            <p className="hero-note">
              <span className="tick">✓</span> No credit card &nbsp;·&nbsp; Connect GitHub in 30s &nbsp;·&nbsp; Built on Box
            </p>
          </div>
          <div>
            <Pipeline />
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <Reveal className="section-head">
            <span className="eyebrow">The build loop</span>
            <h2>Four stops from complaint to commit.</h2>
            <p>Every request follows the same path. You stay in control; Rantify does the rest.</p>
          </Reveal>
          <Reveal className="steps" delay={60}>
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="num">{s.n}</span>
                <span className="bead" style={{ background: s.c }} />
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <Reveal className="cta">
            <span className="eyebrow">Stop filing tickets</span>
            <h2 className="display">Got a feature in mind?</h2>
            <p>Turn your loudest complaint into your next favorite tool. It takes one sentence to start.</p>
            <div className="cta-actions">
              <Link to="/submit" className="btn btn-accent btn-lg">Submit your first request <IconArrow className="arrow" /></Link>
              <Link to="/app" className="btn btn-ghost btn-lg">Open dashboard</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
