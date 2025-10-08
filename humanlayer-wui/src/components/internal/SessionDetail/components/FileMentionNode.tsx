import { NodeViewWrapper } from '@tiptap/react'
import { FileIcon, FolderIcon } from 'lucide-react'

interface FileMentionNodeProps {
  node: {
    attrs: {
      id: string
      label: string
      isDirectory: boolean
    }
  }
}

export const FileMentionNode = ({ node }: FileMentionNodeProps) => {
  const { label, id, isDirectory } = node.attrs

  return (
    <NodeViewWrapper
      as="span"
      className="mention"
      contentEditable={false}
      data-mention={id}
      data-is-directory={isDirectory ? 'true' : 'false'}
      title={`Open ${id}`}
    >
      {isDirectory ? (
        <FolderIcon className="inline-block mr-1 h-3.5 w-3.5" />
      ) : (
        <FileIcon className="inline-block mr-1 h-3.5 w-3.5" />
      )}
      @{label || id}
    </NodeViewWrapper>
  )
}
