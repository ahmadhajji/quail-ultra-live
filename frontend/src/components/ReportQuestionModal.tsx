import { useEffect, useState } from 'react'
import { submitQuestionReport } from '../lib/api'

interface ReportQuestionModalProps {
  open: boolean
  packId: string
  questionId: string
  onClose: () => void
}

const CATEGORIES = [
  { value: 'wrong-answer-key', label: 'Wrong answer key' },
  { value: 'typo-stem', label: 'Typo or error in stem' },
  { value: 'bad-explanation', label: 'Bad explanation' },
  { value: 'other', label: 'Other' }
]

export function ReportQuestionModal({ open, packId, questionId, onClose }: ReportQuestionModalProps) {
  const [category, setCategory] = useState('wrong-answer-key')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function handleClose() {
    setCategory('wrong-answer-key')
    setMessage('')
    setSubmitting(false)
    setSubmitted(false)
    setError('')
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await submitQuestionReport(packId, questionId, category, message.trim())
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal fade show"
      style={{ display: 'block', background: 'rgba(15, 23, 42, 0.55)' }}
      aria-modal="true"
      role="dialog"
      onClick={handleClose}
    >
      <div
        className="modal-dialog modal-dialog-centered"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Report Question</h5>
            <button type="button" className="btn-close" aria-label="Close" onClick={handleClose} />
          </div>
          {submitted ? (
            <>
              <div className="modal-body">
                <p className="mb-0 text-success">Thanks for the report! We'll review it.</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-primary" onClick={handleClose}>Close</button>
              </div>
            </>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label" htmlFor="report-category">Issue type</label>
                  <select
                    id="report-category"
                    className="form-select form-select-sm"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label" htmlFor="report-message">
                    Additional notes <span className="text-muted">(optional)</span>
                  </label>
                  <textarea
                    id="report-message"
                    className="form-control form-control-sm"
                    rows={3}
                    maxLength={2000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe the issue…"
                  />
                </div>
                {error ? <div className="alert alert-danger py-1 px-2 small">{error}</div> : null}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-danger" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Submit Report'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
