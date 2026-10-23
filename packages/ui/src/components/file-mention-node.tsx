import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { FileIcon, FileText, FolderIcon } from 'lucide-react'

export const FileMentionNode = ({ node }: NodeViewProps) => {
  const id = node.attrs.id as string
  const label = node.attrs.label as string
  const isDirectory = node.attrs.isDirectory as boolean
  const isArtifact = node.attrs.isArtifact as boolean

  return (
    <NodeViewWrapper
      as="span"
      className="mention"
      contentEditable={false}
      data-mention={id}
      data-is-artifact={isArtifact ? 'true' : 'false'}
      data-is-directory={isDirectory ? 'true' : 'false'}
    >
      {isArtifact ? (
        <FileText className="inline-block mr-1 h-3.5 w-3.5" />
      ) : isDirectory ? (
        <FolderIcon className="inline-block mr-1 h-3.5 w-3.5" />
      ) : (
        <FileIcon className="inline-block mr-1 h-3.5 w-3.5" />
      )}
      {isArtifact ? `@artifact:${label || id}` : `@file:${label || id}`}
    </NodeViewWrapper>
  )
}
