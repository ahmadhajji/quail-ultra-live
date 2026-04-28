export const MIN_ANSWER_STATS_PEER_COUNT = 3

export type AnswerAnalyticsSubmission = {
  systemPackId: string
  questionId: string
  userId: string
  selectedChoice: string
  correctChoice: string
  answeredAt: string
}

export type AnswerDistributionRow = {
  question_id: string
  selected_choice: string
  answer_count: number
}

export type QuestionStatsPayload = {
  eligible: boolean
  peerCount: number
  minPeerCount: number
  correctChoice: string
  correctPercent: number | null
  choices: Record<string, {
    count: number | null
    percent: number | null
  }>
}

function roundPercent(count: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.round((count / total) * 100)
}

function submittedAnswer(progress: any, blockKey: string, index: number): string {
  const block = progress?.blockhist?.[blockKey]
  const state = block?.questionStates?.[index]
  const answer = block?.answers?.[index]
  if (!state?.submitted || typeof answer !== 'string' || !answer) {
    return ''
  }
  return answer
}

export function collectNewlySubmittedAnswers(input: {
  systemPackId: string
  userId: string
  previousProgress: any
  nextProgress: any
  choices: Record<string, { correct?: string }>
  answeredAt: string
}): AnswerAnalyticsSubmission[] {
  const submissions: AnswerAnalyticsSubmission[] = []
  const nextBlockhist = input.nextProgress?.blockhist
  if (!nextBlockhist || typeof nextBlockhist !== 'object') {
    return submissions
  }

  for (const [blockKey, block] of Object.entries(nextBlockhist)) {
    const blockRecord = block as any
    const qids = Array.isArray(blockRecord?.blockqlist) ? blockRecord.blockqlist : []
    for (let index = 0; index < qids.length; index += 1) {
      const questionId = typeof qids[index] === 'string' ? qids[index] : ''
      const selectedChoice = submittedAnswer(input.nextProgress, blockKey, index)
      if (!questionId || !selectedChoice || submittedAnswer(input.previousProgress, blockKey, index)) {
        continue
      }
      const correctChoice = input.choices[questionId]?.correct ?? ''
      submissions.push({
        systemPackId: input.systemPackId,
        questionId,
        userId: input.userId,
        selectedChoice,
        correctChoice,
        answeredAt: input.answeredAt
      })
    }
  }

  return submissions
}

export function buildQuestionStats(input: {
  ids: string[]
  eligible: boolean
  choices: Record<string, { options?: string[]; correct?: string }>
  rows: AnswerDistributionRow[]
  minPeerCount?: number
}): Record<string, QuestionStatsPayload> {
  const minPeerCount = input.minPeerCount ?? MIN_ANSWER_STATS_PEER_COUNT
  const rowsByQuestion = new Map<string, AnswerDistributionRow[]>()
  for (const row of input.rows) {
    const questionId = String(row.question_id || '')
    if (!questionId) {
      continue
    }
    const current = rowsByQuestion.get(questionId) ?? []
    current.push(row)
    rowsByQuestion.set(questionId, current)
  }

  const stats: Record<string, QuestionStatsPayload> = {}
  for (const questionId of input.ids) {
    const choiceMeta = input.choices[questionId]
    const choiceIds = Array.isArray(choiceMeta?.options) ? choiceMeta.options : []
    const questionRows = rowsByQuestion.get(questionId) ?? []
    const peerCount = questionRows.reduce((sum, row) => sum + Number(row.answer_count || 0), 0)
    const hasEnoughPeers = input.eligible && Boolean(choiceMeta) && peerCount >= minPeerCount
    const choiceStats: QuestionStatsPayload['choices'] = {}
    for (const choice of choiceIds) {
      const count = questionRows
        .filter((row) => row.selected_choice === choice)
        .reduce((sum, row) => sum + Number(row.answer_count || 0), 0)
      choiceStats[choice] = {
        count: hasEnoughPeers ? count : null,
        percent: hasEnoughPeers ? roundPercent(count, peerCount) : null
      }
    }
    const correctChoice = choiceMeta?.correct ?? ''
    const correctCount = questionRows
      .filter((row) => row.selected_choice === correctChoice)
      .reduce((sum, row) => sum + Number(row.answer_count || 0), 0)

    stats[questionId] = {
      eligible: input.eligible && Boolean(choiceMeta),
      peerCount,
      minPeerCount,
      correctChoice,
      correctPercent: hasEnoughPeers ? roundPercent(correctCount, peerCount) : null,
      choices: choiceStats
    }
  }

  return stats
}
