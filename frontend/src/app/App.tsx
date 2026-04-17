import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminPage } from '../pages/AdminPage'
import { ExamViewPage } from '../pages/ExamViewPage'
import { HomePage } from '../pages/HomePage'
import { NewBlockPage } from '../pages/NewBlockPage'
import { OverviewPage } from '../pages/OverviewPage'
import { PreviousBlocksPage } from '../pages/PreviousBlocksPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/overview" element={<OverviewPage />} />
      <Route path="/newblock" element={<NewBlockPage />} />
      <Route path="/previousblocks" element={<PreviousBlocksPage />} />
      <Route path="/examview" element={<ExamViewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
