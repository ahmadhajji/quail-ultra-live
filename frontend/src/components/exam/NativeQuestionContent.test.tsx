import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NativeQuestionExplanation, NativeQuestionStem } from './NativeQuestionContent'
import type { NativeQuestion } from '../../lib/native-qbank'

const question: NativeQuestion = {
  id: 'peds.sample.s001.q01',
  schemaVersion: 1,
  status: 'ready',
  stem: {
    blocks: [
      { type: 'paragraph', text: 'Native stem text.' },
      { type: 'media', mediaId: 'stem.image', caption: 'Stem image' }
    ]
  },
  choices: [
    { id: 'A', displayOrder: 1, text: [{ type: 'paragraph', text: 'Alpha' }] },
    { id: 'B', displayOrder: 2, text: [{ type: 'paragraph', text: 'Bravo' }] }
  ],
  answerKey: {
    correctChoiceId: 'B'
  },
  explanation: {
    correct: [
      { type: 'paragraph', text: 'Native explanation text.' },
      { type: 'media', mediaId: 'explanation.image', caption: 'Explanation image' }
    ],
    incorrect: {
      A: [{ type: 'paragraph', text: 'Alpha is incorrect.' }]
    },
    educationalObjective: [
      { type: 'paragraph', text: 'Native objective.' }
    ]
  },
  media: [
    {
      id: 'stem.image',
      path: 'media/stem.svg',
      mimeType: 'image/svg+xml',
      role: 'stem'
    },
    {
      id: 'explanation.image',
      path: 'media/explanation.svg',
      mimeType: 'image/svg+xml',
      role: 'explanation'
    }
  ],
  integrity: {
    contentHash: 'fixture'
  }
}

describe('NativeQuestionContent', () => {
  it('renders stem and explanation media in separate sections', () => {
    render(
      <>
        <section aria-label="stem">
          <NativeQuestionStem question={question} basePath="/api/study-packs/test/file?rev=3" />
        </section>
        <section aria-label="explanation">
          <NativeQuestionExplanation question={question} basePath="/api/study-packs/test/file?rev=3" />
        </section>
      </>
    )

    const stem = screen.getByLabelText('stem')
    const explanation = screen.getByLabelText('explanation')

    expect(within(stem).getByText('Native stem text.')).toBeInTheDocument()
    expect(within(stem).getByAltText('Stem image')).toHaveAttribute('src', '/api/study-packs/test/file/media/stem.svg?rev=3')
    expect(within(stem).queryByAltText('Explanation image')).not.toBeInTheDocument()

    expect(within(explanation).getByText('Native explanation text.')).toBeInTheDocument()
    expect(within(explanation).getByAltText('Explanation image')).toHaveAttribute('src', '/api/study-packs/test/file/media/explanation.svg?rev=3')
    expect(within(explanation).queryByAltText('Stem image')).not.toBeInTheDocument()
  })
})
