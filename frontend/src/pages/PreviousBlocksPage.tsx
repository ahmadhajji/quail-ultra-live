import { useMemo, useState } from 'react'
import { LoadingScreen } from '../components/LoadingScreen'
import { PackTopBar } from '../components/PackTopBar'
import { deleteBlock } from '../lib/api'
import { navigate } from '../lib/navigation'
import { usePackPage } from '../lib/usePackPage'
import type { BlockRecord } from '../types/domain'

function modeLabel(mode: BlockRecord['mode']): string {
  return 'Tutor'
}

export function PreviousBlocksPage() {
  const { loading, packId, qbankinfo, setQbankinfo } = usePackPage()
  const [modalBlockKey, setModalBlockKey] = useState<string>('')

  const blockEntries = useMemo(() => {
    if (!qbankinfo) {
      return []
    }
    return Object.entries(qbankinfo.progress.blockhist).sort((a, b) => Number(b[0]) - Number(a[0]))
  }, [qbankinfo])

  if (loading || !qbankinfo) {
    return (
      <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
        <LoadingScreen />
      </div>
    )
  }

  const modalBlock = modalBlockKey ? qbankinfo.progress.blockhist[modalBlockKey] : undefined

  return (
    <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
      <PackTopBar
        subtitle="Block History"
        active="previousblocks"
        onBack={() => navigate('index')}
        onOverview={() => navigate('overview', { pack: packId })}
        onNewBlock={() => navigate('newblock', { pack: packId })}
        onPreviousBlocks={() => navigate('previousblocks', { pack: packId })}
      />

      <div className="q-panel" style={{ margin: '0 8px 24px' }}>
        <div className="q-panel-header">
          <div>
            <p className="q-panel-title">Previous Blocks</p>
            <p className="q-panel-subtitle">Resume incomplete sessions or reopen completed blocks directly into the updated review interface.</p>
          </div>
        </div>
        <div className="q-panel-body q-table-wrap">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Block #</th>
                  <th>Mode</th>
                  <th>State</th>
                  <th>% Correct</th>
                  <th>Num Qs</th>
                  <th>Q Pool</th>
                  <th>Tags</th>
                  <th>Start Time</th>
                  <th>Open</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {blockEntries.map(([blockKey, block]) => {
                  const numQuestions = block.blockqlist.length
                  const percentCorrect = block.complete && numQuestions > 0 ? `${((100 * block.numcorrect) / numQuestions).toFixed(1)}%` : null
                  const rowClass = blockKey === qbankinfo.blockToOpen ? (block.complete ? 'table-success' : 'table-warning') : ''
                  return (
                    <tr key={blockKey} className={rowClass}>
                      <td>{Number(blockKey) + 1}</td>
                      <td>{modeLabel(block.mode)}</td>
                      <td>{block.complete ? 'Completed Review' : 'Paused Session'}</td>
                      <td>{percentCorrect ?? <strong><em>In Progress</em></strong>}</td>
                      <td><button className="btn btn-link" type="button" style={{ padding: 0 }} onClick={() => setModalBlockKey(blockKey)}>{numQuestions}</button></td>
                      <td>{block.qpoolstr}</td>
                      <td>{block.allsubtagsenabled ? 'All Subtags' : 'Filtered'}</td>
                      <td>{block.starttime}</td>
                      <td><button className="btn btn-link" type="button" style={{ padding: 0 }} onClick={() => navigate('examview', { pack: packId, block: blockKey })}>{block.complete ? 'Review' : 'Resume'}</button></td>
                      <td>
                        <button
                          className="btn btn-outline-danger"
                          type="button"
                          style={{ padding: '0 8px', fontSize: 12 }}
                          onClick={async () => {
                            if (!window.confirm(`Permanently delete block ${Number(blockKey) + 1}? Questions will return to the unused pool. Incorrect and flagged history for that block will be discarded.`)) {
                              return
                            }
                            await deleteBlock(packId, blockKey)
                            setQbankinfo((current) => {
                              if (!current) {
                                return current
                              }
                              const next = structuredClone(current)
                              delete next.progress.blockhist[blockKey]
                              return next
                            })
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalBlock ? (
        <div className="modal fade show" style={{ display: 'block', background: 'rgba(15, 23, 42, 0.45)' }} aria-modal="true" role="dialog">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Block {Number(modalBlockKey) + 1} Question List</h5>
                <button type="button" className="close" aria-label="Close" onClick={() => setModalBlockKey('')}>
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p>{modalBlock.blockqlist.join(', ')}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
