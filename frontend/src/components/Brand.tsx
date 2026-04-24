interface BrandProps {
  title: string
  subtitle?: string
}

export function Brand({ title, subtitle }: BrandProps) {
  return (
    <div className="q-brand">
      <img className="q-brand-logo" src="/branding/quail-ultra.png" alt="Quail Ultra" />
      <div className="q-brand-copy">
        <p className="q-brand-title">{title}</p>
        {subtitle ? <p className="q-brand-subtitle">{subtitle}</p> : null}
      </div>
    </div>
  )
}
