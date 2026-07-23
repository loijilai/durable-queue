import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import HomePage from './pages/HomePage.tsx'
import AuthPage from './pages/AuthPage.tsx'
import QueuePage from './pages/QueuePage.tsx'
import ConcurrencyPage from './pages/ConcurrencyPage.tsx'
import ScalabilityPage from './pages/ScalabilityPage.tsx'
import HighAvailabilityPage from './pages/HighAvailabilityPage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/concurrency" element={<ConcurrencyPage />} />
        <Route path="/scalability" element={<ScalabilityPage />} />
        <Route path="/high-availability" element={<HighAvailabilityPage />} />
      </Route>
    </Routes>
  )
}

export default App
