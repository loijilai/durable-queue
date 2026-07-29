interface PlaceholderPageProps {
  eyebrow: string
  title: string
  description: string
}

function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <section className="placeholder-page">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        {eyebrow}
      </p>
      <h1>{title}</h1>
      <p className="placeholder-body">{description}</p>
      <div className="placeholder-card">Coming soon — this page is mocked for now.</div>
    </section>
  )
}

export default PlaceholderPage
