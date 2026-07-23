import { Link } from 'react-router-dom'

const SECTIONS = [
  {
    to: '/auth',
    eyebrow: 'AUTHENTICATION',
    title: 'Stateless auth with JWT',
    description: 'Register, log in, and inspect a decoded JWT payload live in the browser.',
  },
  {
    to: '/queue',
    eyebrow: 'CORE FEATURE',
    title: 'Distributed queue & async pattern',
    description: 'Submit a job, poll real status transitions from PENDING to SUCCEEDED.',
  },
  {
    to: '/concurrency',
    eyebrow: 'DURABILITY WALKTHROUGH',
    title: 'Why every piece of this queue exists',
    description: 'The causal chain from "a worker can die mid-task" to visibility timeout, idempotency, locking, and retry.',
  },
  {
    to: '/scalability',
    eyebrow: 'SCALE OUT',
    title: 'Worker pool & backpressure',
    description: 'Generate load and watch queue depth rise and drain in real time.',
  },
  {
    to: '/high-availability',
    eyebrow: 'HIGH AVAILABILITY',
    title: 'Single-AZ today, multi-AZ roadmap',
    description: 'Known SPOF, and a deliberate reason it is deferred to the K8s stage.',
  },
]

function HomePage() {
  return (
    <section className="home">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        DURABLE QUEUE
      </p>
      <h1>A YouTube transcription queue, built to survive worker crashes.</h1>
      <p className="home-lede">
        Job state lives in the database, not in memory — workers can die and restart without
        losing work. This demo walks through the design decisions behind that guarantee.
      </p>

      <div className="section-grid">
        {SECTIONS.map((section) => (
          <Link key={section.to} to={section.to} className="section-card">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              {section.eyebrow}
            </p>
            <h3>{section.title}</h3>
            <p>{section.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default HomePage
