import { NodeViewWrapper } from '@tiptap/react'
import { FileIcon, FolderIcon, HatGlasses, ImageIcon, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/utils'

interface FileMentionNodeProps {
  node: {
    attrs: {
      id: string
      label: string
      isDirectory: boolean
    }
  }
  deleteNode: () => void
}

// Image file extensions
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']

function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}

export const FileMentionNode = ({ node, deleteNode }: FileMentionNodeProps) => {
  const { label, id, isDirectory } = node.attrs
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)

  // Check if this is an agent mention (id starts with "@agent-")
  const isAgent = id.startsWith('@agent-')
  const isImage = !isDirectory && !isAgent && isImageFile(id)

  // Load image preview for image files
  useEffect(() => {
    if (isImage && isTauri()) {
      try {
        // Convert file path to asset URL for Tauri
        const assetUrl = convertFileSrc(id)
        setImageSrc(assetUrl)
      } catch (error) {
        console.error('Failed to convert file path to asset URL:', error)
        setImageError(true)
      }
    }
  }, [id, isImage])

  // Render image mention with preview
  if (isImage && imageSrc && !imageError) {
    return (
      <NodeViewWrapper
        as="span"
        className="inline-flex items-center gap-1 align-middle"
        contentEditable={false}
        data-mention={id}
      >
        <span className="relative group inline-block">
          <img
            src={imageSrc}
            alt={label || 'Image preview'}
            className="h-16 max-w-32 object-contain rounded border border-border"
            onError={() => setImageError(true)}
          />
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              deleteNode()
            }}
            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
            title="Remove image"
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      </NodeViewWrapper>
    )
  }

  // Fallback for images that failed to load - show as regular mention with image icon
  if (isImage) {
    return (
      <NodeViewWrapper
        as="span"
        className="mention inline-flex items-center gap-1"
        contentEditable={false}
        data-mention={id}
        title={`Open ${id}`}
      >
        <ImageIcon className="inline-block h-3.5 w-3.5" />
        <span>@{label || id}</span>
        <button
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            deleteNode()
          }}
          className="ml-0.5 p-0.5 rounded hover:bg-destructive hover:text-destructive-foreground"
          title="Remove"
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="span"
      className="mention"
      contentEditable={false}
      data-mention={id}
      data-is-directory={isDirectory ? 'true' : 'false'}
      title={`Open ${id}`}
    >
      {isAgent ? (
        <HatGlasses className="inline-block mr-1 h-3.5 w-3.5" />
      ) : isDirectory ? (
        <FolderIcon className="inline-block mr-1 h-3.5 w-3.5" />
      ) : (
        <FileIcon className="inline-block mr-1 h-3.5 w-3.5" />
      )}
      @{label || id}
    </NodeViewWrapper>
  )
}
