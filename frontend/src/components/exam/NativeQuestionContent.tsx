import { blocksToPlainText, nativeMediaUrl, type NativeContentBlock, type NativeMediaRef, type NativeQuestion } from '../../lib/native-qbank'

interface NativeContentProps {
  blocks: NativeContentBlock[] | undefined
  basePath: string
  mediaById: Map<string, NativeMediaRef>
  maxImageHeight: string
}

function NativeContentBlocks({ blocks, basePath, mediaById, maxImageHeight }: NativeContentProps) {
  if (!blocks?.length) {
    return null
  }

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return <p key={index}>{block.text}</p>
        }
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          )
        }
        if (block.type === 'table') {
          return (
            <div className="table-responsive" key={index}>
              <table className="table table-sm">
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        const media = mediaById.get(block.mediaId)
        if (!media || !media.mimeType.startsWith('image/')) {
          return null
        }
        const src = nativeMediaUrl(basePath, media.path)
        return (
          <figure key={index}>
            <img
              src={src}
              alt={block.caption || media.id}
              data-openable-image="true"
              data-image-caption={block.caption || media.id}
              tabIndex={0}
              style={{ maxWidth: '100%', maxHeight: maxImageHeight, height: 'auto', cursor: 'zoom-in' }}
            />
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>
        )
      })}
    </>
  )
}

function mediaMap(question: NativeQuestion): Map<string, NativeMediaRef> {
  return new Map(question.media.map((media) => [media.id, media]))
}

export function NativeQuestionStem({ question, basePath }: { question: NativeQuestion; basePath: string }) {
  return (
    <NativeContentBlocks
      blocks={question.stem.blocks}
      basePath={basePath}
      mediaById={mediaMap(question)}
      maxImageHeight={`${Math.floor(window.innerHeight * 0.4)}px`}
    />
  )
}

export function NativeQuestionExplanation({ question, basePath }: { question: NativeQuestion; basePath: string }) {
  const mediaById = mediaMap(question)
  const incorrectEntries = Object.entries(question.explanation.incorrect ?? {})
    .filter(([, blocks]) => blocksToPlainText(blocks))

  return (
    <>
      <h4>Explanation</h4>
      <NativeContentBlocks
        blocks={question.explanation.correct}
        basePath={basePath}
        mediaById={mediaById}
        maxImageHeight={`${Math.floor(window.innerHeight * 0.5)}px`}
      />
      {incorrectEntries.length > 0 ? (
        <>
          <h4>Why other answers are incorrect</h4>
          {incorrectEntries.map(([choiceId, blocks]) => (
            <div key={choiceId}>
              <p><strong>{choiceId}.</strong></p>
              <NativeContentBlocks
                blocks={blocks}
                basePath={basePath}
                mediaById={mediaById}
                maxImageHeight={`${Math.floor(window.innerHeight * 0.5)}px`}
              />
            </div>
          ))}
        </>
      ) : null}
      {question.explanation.educationalObjective?.length ? (
        <>
          <h4>Educational Objective</h4>
          <NativeContentBlocks
            blocks={question.explanation.educationalObjective}
            basePath={basePath}
            mediaById={mediaById}
            maxImageHeight={`${Math.floor(window.innerHeight * 0.5)}px`}
          />
        </>
      ) : null}
    </>
  )
}
