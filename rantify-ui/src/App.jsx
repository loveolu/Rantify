import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import MarketingLayout from './components/MarketingLayout';
import AppLayout from './components/AppLayout';
import Landing from './pages/Landing';
import Features from './pages/Features';
import Pricing from './pages/Pricing';
import Dashboard from './pages/Dashboard';
import CardDetail from './pages/CardDetail';
import SubmitForm from './pages/SubmitForm';
import OAuthStatus from './pages/OAuthStatus';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

const marketing = (el) => <MarketingLayout>{el}</MarketingLayout>;
const app = (el) => <AppLayout>{el}</AppLayout>;

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* marketing site */}
        <Route path="/" element={marketing(<Landing />)} />
        <Route path="/features" element={marketing(<Features />)} />
        <Route path="/pricing" element={marketing(<Pricing />)} />

        {/* product app */}
        <Route path="/app" element={app(<Dashboard />)} />
        <Route path="/submit" element={app(<SubmitForm />)} />
        <Route path="/card/:fileId" element={app(<CardDetail />)} />
        <Route path="/integrations" element={app(<OAuthStatus />)} />
        <Route path="/oauth" element={app(<OAuthStatus />)} />
      </Routes>
    </BrowserRouter>
  );
}
