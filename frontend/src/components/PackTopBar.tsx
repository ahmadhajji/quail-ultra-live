import { Brand } from './Brand'

interface PackTopBarProps {
  subtitle: string
  active: 'overview' | 'newblock' | 'previousblocks'
  onBack: () => void
  onOverview: () => void
  onNewBlock: () => void
  onPreviousBlocks: () => void
}

export function PackTopBar(props: PackTopBarProps) {
  const { subtitle, active, onBack, onOverview, onNewBlock, onPreviousBlocks } = props
  return (
    <div className="row q-topbar">
      <div className="col-lg-4 d-flex align-items-center">
        <button className="q-back-btn btn" type="button" onClick={onBack}>&lsaquo;</button>
        <Brand title="Quail Ultra" subtitle={subtitle} />
      </div>
      <div className="col-lg-8 d-flex justify-content-lg-end justify-content-start mt-3 mt-lg-0">
        <ul className="nav nav-pills q-nav-pills">
          <li className="nav-item">
            <button className={`nav-link btn btn-link ${active === 'overview' ? 'active' : ''}`} type="button" onClick={onOverview}>Overview</button>
          </li>
          <li className="nav-item">
            <button className={`nav-link btn btn-link ${active === 'newblock' ? 'active' : ''}`} type="button" onClick={onNewBlock}>New Block</button>
          </li>
          <li className="nav-item">
            <button className={`nav-link btn btn-link ${active === 'previousblocks' ? 'active' : ''}`} type="button" onClick={onPreviousBlocks}>Previous Blocks</button>
          </li>
        </ul>
      </div>
    </div>
  )
}
