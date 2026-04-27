import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { getSession, submitSupportTicket } from '../lib/api'
import { navigate } from '../lib/navigation'
import type { User } from '../types/domain'

const FAQ_ITEMS = [
  {
    q: 'How do I get started?',
    a: 'Go to the Library tab in the sidebar and add a study pack to your account. Then select it on the Home screen, click "New Block", configure your session, and start studying.'
  },
  {
    q: 'How do I add a study pack?',
    a: 'Click "Library" in the sidebar. Find the pack you want and click "Add to My Packs". It will appear on your Home screen.'
  },
  {
    q: 'What is a Block?',
    a: 'A block is a focused study session. You choose the question pool (unused, incorrect, flagged), the number of questions, and any tag filters — then start answering. Your progress is saved automatically.'
  },
  {
    q: 'How is my progress saved?',
    a: 'Progress syncs to the server automatically as you answer questions. If you go offline, changes are stored locally and synced when you reconnect.'
  },
  {
    q: 'Can I flag questions to review later?',
    a: 'Yes. During a block, use the flag button on any question. Flagged questions appear in the "Flagged" pool when you create a new block.'
  },
  {
    q: 'How do I report a problem with a question?',
    a: 'While in a study block, click the "Report" button in the footer. Choose a category and optionally add a note — the report goes directly to the admin.'
  }
]

export function SupportPage() {
  const [user, setUser] = useState<User | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('feedback')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    getSession(true).then((u) => {
      if (cancelled) return
      if (!u) { navigate('index'); return }
      setUser(u)
    }).catch(() => { if (!cancelled) navigate('index') })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!subject.trim()) { setFormError('Please enter a subject.'); return }
    if (!message.trim()) { setFormError('Please enter a message.'); return }
    setSubmitting(true)
    try {
      await submitSupportTicket(subject.trim(), category, message.trim())
      setSubmitted(true)
      setSubject('')
      setMessage('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell user={user} active="support" title="Support">
      <div className="container py-4" style={{ maxWidth: 720 }}>

        <section className="mb-5">
          <h2 className="h4 mb-3">Frequently Asked Questions</h2>
          <div className="accordion" id="faqAccordion">
            {FAQ_ITEMS.map((item, index) => (
              <div className="accordion-item" key={index}>
                <h3 className="accordion-header">
                  <button
                    className={`accordion-button${openFaq === index ? '' : ' collapsed'}`}
                    type="button"
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    aria-expanded={openFaq === index}
                  >
                    {item.q}
                  </button>
                </h3>
                {openFaq === index ? (
                  <div className="accordion-collapse">
                    <div className="accordion-body">{item.a}</div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="h4 mb-3">Submit Feedback or Report an Issue</h2>
          {submitted ? (
            <div className="alert alert-success">
              Thanks for reaching out! Your message has been received.
              <button
                type="button"
                className="btn btn-sm btn-outline-success ms-3"
                onClick={() => setSubmitted(false)}
              >
                Send another
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="mb-3">
                <label className="form-label" htmlFor="support-category">Category</label>
                <select
                  id="support-category"
                  className="form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="feedback">General Feedback</option>
                  <option value="bug">Bug Report</option>
                  <option value="question">Question</option>
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="support-subject">Subject</label>
                <input
                  id="support-subject"
                  type="text"
                  className="form-control"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief summary"
                />
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="support-message">Message</label>
                <textarea
                  id="support-message"
                  className="form-control"
                  rows={5}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your feedback or issue in detail"
                />
                <div className="form-text text-end">{message.length}/2000</div>
              </div>
              {formError ? <div className="alert alert-danger py-2">{formError}</div> : null}
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          )}
        </section>

      </div>
    </AppShell>
  )
}
