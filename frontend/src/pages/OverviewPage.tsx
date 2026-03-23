import { PackTopBar } from '../components/PackTopBar'
import { LoadingScreen } from '../components/LoadingScreen'
import { resetPack, syncProgress } from '../lib/api'
import { navigate } from '../lib/navigation'
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
  const { loading, packId, qbankinfo, setQbankinfo } = usePackPage()

  if (loading || !qbankinfo) {
    return (
      <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
        <LoadingScreen />
      </div>
    )
  }

  let numCorrect = 0
  let totalAnswered = 0
  let completeBlocks = 0
  let pausedBlocks = 0
  let totalTime = 0
  let tutorBlocks = 0
  let timedBlocks = 0
  let untimedBlocks = 0

  Object.values(qbankinfo.progress.blockhist).forEach((block) => {
    if (block.mode === 'timed') {
      timedBlocks += 1
    } else if (block.mode === 'untimed') {
      untimedBlocks += 1
    } else {
      tutorBlocks += 1
    }

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
    <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
      <PackTopBar
        subtitle="Overview"
        active="overview"
        onBack={() => navigate('index')}
        onOverview={() => navigate('overview', { pack: packId })}
        onNewBlock={() => navigate('newblock', { pack: packId })}
        onPreviousBlocks={() => navigate('previousblocks', { pack: packId })}
      />

      <div className="q-stat-grid">
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Performance</p><p className="q-panel-subtitle">Completed blocks only.</p></div></div>
          <div className="q-panel-body"><div className="table-responsive table-borderless"><table className="table table-bordered mb-0"><tbody>
            <tr><td>Correct Answers</td><td>{numCorrect} ({formatPercent(numCorrect, totalAnswered)})</td></tr>
            <tr><td>Incorrect Answers</td><td>{numIncorrect} ({formatPercent(numIncorrect, totalAnswered)})</td></tr>
            <tr><td>Total Answers</td><td>{totalAnswered}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Coverage</p><p className="q-panel-subtitle">Complete and paused blocks.</p></div></div>
          <div className="q-panel-body"><div className="table-responsive table-borderless"><table className="table table-bordered mb-0"><tbody>
            <tr><td>Questions Seen</td><td>{numSeen}/{numAll} ({formatPercent(numSeen, numAll)})</td></tr>
            <tr><td>Questions Flagged</td><td>{numFlagged}/{numSeen || 0} ({formatPercent(numFlagged, numSeen)})</td></tr>
            <tr><td>Total Questions in QBank</td><td>{numAll}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Blocks</p><p className="q-panel-subtitle">Mode counts and session states.</p></div></div>
          <div className="q-panel-body"><div className="table-responsive table-borderless"><table className="table table-bordered mb-0"><tbody>
            <tr><td>Completed</td><td>{completeBlocks}</td></tr>
            <tr><td>Paused</td><td>{pausedBlocks}</td></tr>
            <tr><td>Tutor Blocks</td><td>{tutorBlocks}</td></tr>
            <tr><td>Timed Blocks</td><td>{timedBlocks}</td></tr>
            <tr><td>Untimed Blocks</td><td>{untimedBlocks}</td></tr>
          </tbody></table></div></div>
        </div>
        <div className="q-panel">
          <div className="q-panel-header"><div><p className="q-panel-title">Time</p><p className="q-panel-subtitle">Completed blocks only.</p></div></div>
          <div className="q-panel-body"><div className="table-responsive table-borderless"><table className="table table-bordered mb-0"><tbody>
            <tr><td>Average Time Per Question</td><td>{avgTime.toFixed(1)} sec</td></tr>
            <tr><td>Total Time</td><td>{formatDuration(totalTime)}</td></tr>
          </tbody></table></div></div>
        </div>
      </div>

      <div className="q-panel" style={{ margin: '0 8px 24px' }}>
        <div className="q-panel-header">
          <div>
            <p className="q-panel-title">Actions</p>
            <p className="q-panel-subtitle">Reset progress for the currently loaded question bank if you need a clean slate.</p>
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
              const emptyProgress = {
                blockhist: {},
                tagbuckets: qbankinfo.progress.tagbuckets
              }
              await syncProgress(packId, emptyProgress)
              window.location.reload()
            }}
          >
            Reset Question Bank
          </button>
        </div>
      </div>
    </div>
  )
}
