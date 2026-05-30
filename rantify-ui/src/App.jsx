import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CardDetail from './pages/CardDetail';
import SubmitForm from './pages/SubmitForm';
import OAuthStatus from './pages/OAuthStatus';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/card/:fileId" element={<CardDetail />} />
          <Route path="/submit" element={<SubmitForm />} />
          <Route path="/oauth" element={<OAuthStatus />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
