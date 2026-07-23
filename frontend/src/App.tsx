import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import HomePage from './pages/HomePage.tsx'
import AuthPage from './pages/AuthPage.tsx'
import GoogleCallbackPage from './pages/GoogleCallbackPage.tsx'
import QueuePage from './pages/QueuePage.tsx'
import DurabilityWalkthroughPage from './pages/DurabilityWalkthroughPage.tsx'
import ScalabilityPage from './pages/ScalabilityPage.tsx'
import HighAvailabilityPage from './pages/HighAvailabilityPage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/concurrency" element={<DurabilityWalkthroughPage />} />
        <Route path="/scalability" element={<ScalabilityPage />} />
        <Route path="/high-availability" element={<HighAvailabilityPage />} />
      </Route>
    </Routes>
  )
}

export default App
