import { NavLink } from 'react-router-dom';

export default function Layout({ children }) {
  return (
    <div className="layout">
      <header className="header">
        <NavLink to="/" className="logo">DevTool Loop</NavLink>
        <nav className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/submit">Submit Idea</NavLink>
          <NavLink to="/oauth">OAuth</NavLink>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
