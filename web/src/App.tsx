import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useI18n } from './i18n';
import { ConsolePage } from './pages/ConsolePage';
import { LiveRoomPage } from './pages/LiveRoomPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProgramPage } from './pages/ProgramPage';

export function App() {
  return (
    <Routes>
      <Route path="program/:sessionId" element={<ProgramPage />} />
      <Route element={<Layout />}>
        <Route index element={<ConsolePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="live/:sessionId" element={<LiveRoomPage />} />
        <Route path="*" element={<MissingPage />} />
      </Route>
    </Routes>
  );
}

function MissingPage() {
  const { t } = useI18n();
  return (
    <section className="page">
      <h1>{t('common.notFound')}</h1>
    </section>
  );
}
