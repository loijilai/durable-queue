import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import HomePage from './pages/HomePage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import QueuePage from './pages/QueuePage.jsx'
import ConcurrencyPage from './pages/ConcurrencyPage.jsx'
import ScalabilityPage from './pages/ScalabilityPage.jsx'
import HighAvailabilityPage from './pages/HighAvailabilityPage.jsx'

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
