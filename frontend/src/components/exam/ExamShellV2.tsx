import type { ReactNode } from 'react'

interface ExamShellV2Props {
  mode: 'legacy' | 'v2'
  topbar: ReactNode
  rail: ReactNode
  workspace: ReactNode
  footer: ReactNode
}

export function ExamShellV2(props: ExamShellV2Props) {
  const { mode, topbar, rail, workspace, footer } = props

  return (
    <div className={`exam-app exam-v2-shell exam-v2-shell-${mode}`}>
      {topbar}
      <div className="exam-stage exam-stage-continuous exam-v2-stage">
        {rail}
        <main className="exam-workspace exam-workspace-continuous exam-v2-workspace">
          {workspace}
        </main>
      </div>
      {footer}
    </div>
  )
}
