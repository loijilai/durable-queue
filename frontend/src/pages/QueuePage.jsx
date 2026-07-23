import PlaceholderPage from '../components/PlaceholderPage.jsx'

function QueuePage() {
  return (
    <PlaceholderPage
      eyebrow="CORE FEATURE"
      title="Distributed Queue & Async Pattern"
      description="Submit a YouTube URL, watch the job move through PENDING → RUNNING → SUCCEEDED/FAILED via real polling of the job status API."
    />
  )
}

export default QueuePage
