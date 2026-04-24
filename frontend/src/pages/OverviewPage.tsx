import { AppShell } from '../components/AppShell'
import { LoadingScreen } from '../components/LoadingScreen'
import { resetPack } from '../lib/api'
import { normalizeProgress } from '../lib/progress'
import { usePackPage } from '../lib/usePackPage'

function formatPercent(part: number, total: number): string {
  if (total === 0) {
    return '0.0%'
  }
  return `${((100 * part) / total).toFixed(1)}%`
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 3600)} hours, ${Math.floor((seconds % 3600) / 60)} minutes, ${Math.floor(seconds % 60)} seconds`
}

export function OverviewPage() {
  const { loading, user, packId, packName, qbankinfo, setQbankinfo } = usePackPage()

  if (loading || !qbankinfo) {
    return (
      <AppShell user={user} active="overview" packId={packId} packName={packName} title="Overview">
        <LoadingScreen />
      </AppShell>
    )
  }

  let numCorrect = 0
  let totalAnswered = 0
  let completeBlocks = 0
  let pausedBlocks = 0
  let totalTime = 0
  let tutorBlocks = 0

  Object.values(qbankinfo.progress.blockhist).forEach((block) => {
    tutorBlocks += 1

    if (block.complete) {
      completeBlocks += 1
      totalAnswered += block.blockqlist.length
      numCorrect += block.numcorrect
      totalTime += block.elapsedtime
    } else {
      pausedBlocks += 1
    }
  })

  const numIncorrect = totalAnswered - numCorrect
  const avgTime = totalAnswered === 0 ? 0 : totalTime / totalAnswered
  const primaryTag = qbankinfo.tagnames.tagnames['0'] ?? ''
  let numUnused = 0
  let numAll = 0
  let numFlagged = 0
  Object.values(qbankinfo.progress.tagbuckets[primaryTag] ?? {}).forEach((bucket) => {
    numUnused += bucket.unused.length
    numAll += bucket.all.length
    numFlagged += bucket.flagged.length
  })
  const numSeen = numAll - numUnused

  return (
    <AppShell
      user={user}
      active="overview"
      packId={packId}
      packName={packName}
      title={packName ? `${packName} — Overview` : 'Overview'}
    >
      <div className="q-stat-grid">
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Performance</p></div></div>
          <div className="q-panel-body q-table-wrap"><div className="table-responsive"><table className="table mb-0"><tbody>
            <tr><td>Correct Answers</td><td>{numCorrect} ({formatPercent(numCorrect, totalAnswered)})</td></tr>
            <tr><td>Incorrect Answers</td><td>{numIncorrect} ({formatPercent(numIncorrect, totalAnswered)})</td></tr>
            <tr><td>Total Answers</td><td>{totalAnswered}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Coverage</p></div></div>
          <div className="q-panel-body q-table-wrap"><div className="table-responsive"><table className="table mb-0"><tbody>
            <tr><td>Questions Seen</td><td>{numSeen}/{numAll} ({formatPercent(numSeen, numAll)})</td></tr>
            <tr><td>Questions Flagged</td><td>{numFlagged}/{numSeen || 0} ({formatPercent(numFlagged, numSeen)})</td></tr>
            <tr><td>Total Questions in QBank</td><td>{numAll}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Blocks</p></div></div>
          <div className="q-panel-body q-table-wrap"><div className="table-responsive"><table className="table mb-0"><tbody>
            <tr><td>Completed</td><td>{completeBlocks}</td></tr>
            <tr><td>Paused</td><td>{pausedBlocks}</td></tr>
            <tr><td>Tutor Blocks</td><td>{tutorBlocks}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Time</p></div></div>
          <div className="q-panel-body q-table-wrap"><div className="table-responsive"><table className="table mb-0"><tbody>
            <tr><td>Average Time Per Question</td><td>{avgTime.toFixed(1)} sec</td></tr>
            <tr><td>Total Time</td><td>{formatDuration(totalTime)}</td></tr>
          </tbody></table></div></div>
        </div>
      </div>

      <div className="q-panel" style={{ margin: '0 8px 24px' }}>
        <div className="q-panel-header">
          <div>
            <p className="q-panel-title">Actions</p>
          </div>
        </div>
        <div className="q-panel-body">
          <button
            className="btn btn-outline-danger q-danger-btn"
            type="button"
            onClick={async () => {
              if (!window.confirm('Delete all progress for this study pack and reset it?')) {
                return
              }
              await resetPack(packId)
              setQbankinfo((current) => {
                if (!current) {
                  return current
                }
                const next = structuredClone(current)
                next.progress = normalizeProgress({
                  blockhist: {},
                  tagbuckets: {}
                }, next)
                return next
              })
            }}
          >
            Reset Question Bank
          </button>
        </div>
      </div>
    </AppShell>
  )
}
