import PlaceholderPage from '../components/PlaceholderPage.tsx'

function ScalabilityPage() {
  return (
    <PlaceholderPage
      eyebrow="SCALE OUT"
      title="Scaling the Worker Pool & API"
      description="Generate load, watch queue depth (pending + running) climb and drain over time as workers catch up — a live view of backpressure."
    />
  )
}

export default ScalabilityPage
