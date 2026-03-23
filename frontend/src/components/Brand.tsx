interface BrandProps {
  title: string
  subtitle: string
}

export function Brand({ title, subtitle }: BrandProps) {
  return (
    <div className="q-brand">
      <div className="q-brand-mark">Q</div>
      <div className="q-brand-copy">
        <p className="q-brand-title">{title}</p>
        <p className="q-brand-subtitle">{subtitle}</p>
      </div>
    </div>
  )
}
