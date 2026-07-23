import PlaceholderPage from '../components/PlaceholderPage.jsx'

function HighAvailabilityPage() {
  return (
    <PlaceholderPage
      eyebrow="HIGH AVAILABILITY"
      title="Single-AZ Today, Multi-AZ Roadmap"
      description="Currently single-AZ with a known SPOF. Multi-AZ (RDS standby, ElastiCache replica, cross-AZ ASG) is deliberately deferred to the K8s stage, when the broker also moves to SQS and the HA topology gets re-evaluated as a whole."
    />
  )
}

export default HighAvailabilityPage
