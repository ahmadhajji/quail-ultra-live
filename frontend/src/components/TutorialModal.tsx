import { useEffect, useState } from 'react'

interface TutorialModalProps {
  open: boolean
  onDismiss: () => void
}

const STEPS = [
  {
    title: 'Welcome to Quail Ultra!',
    body: (
      <>
        <p>To get started, click <strong>Library</strong> in the sidebar and add a study pack to your account.</p>
        <p className="mb-0 text-muted" style={{ fontSize: '0.9em' }}>The library contains question banks you can study from. Just hit "Add to My Packs".</p>
      </>
    )
  },
  {
    title: 'Start your first study session',
    body: (
      <>
        <p>Back on <strong>Home</strong>, select your pack. Then click <strong>New Block</strong> in the sidebar to configure and start a study session.</p>
        <p className="mb-0 text-muted" style={{ fontSize: '0.9em' }}>You can choose which questions to study, how many, and filter by topic.</p>
      </>
    )
  }
]

export function TutorialModal({ open, onDismiss }: TutorialModalProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  const current = STEPS[step]!
  const isLast = step === STEPS.length - 1

  return (
    <div
      className="modal fade show"
      style={{ display: 'block', background: 'rgba(15, 23, 42, 0.55)' }}
      aria-modal="true"
      role="dialog"
      onClick={onDismiss}
    >
      <div
        className="modal-dialog modal-dialog-centered"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{current.title}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onDismiss}
            />
          </div>
          <div className="modal-body">
            {current.body}
          </div>
          <div className="modal-footer justify-content-between">
            <span className="text-muted" style={{ fontSize: '0.85em' }}>
              Step {step + 1} of {STEPS.length}
            </span>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-link btn-sm text-muted p-0" onClick={onDismiss}>
                Skip
              </button>
              {isLast ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={onDismiss}>
                  Get Started
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)}>
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
