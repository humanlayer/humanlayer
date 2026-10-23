import type { Meta, StoryObj } from '@storybook/react'
import { FileIcon, FileText, FolderIcon } from 'lucide-react'

// Standalone badge preview component (same markup as FileMentionNode without TipTap context)
function FileMentionBadge({
  label,
  isDirectory = false,
  isArtifact = false,
}: {
  label: string
  isDirectory?: boolean
  isArtifact?: boolean
}) {
  return (
    <span className="mention" contentEditable={false}>
      {isArtifact ? (
        <FileText className="inline-block mr-1 h-3.5 w-3.5" />
      ) : isDirectory ? (
        <FolderIcon className="inline-block mr-1 h-3.5 w-3.5" />
      ) : (
        <FileIcon className="inline-block mr-1 h-3.5 w-3.5" />
      )}
      {isArtifact ? `@artifact:${label}` : `@file:${label}`}
    </span>
  )
}

const meta: Meta<typeof FileMentionBadge> = {
  title: 'Shell Demos/FileMentionBadge',
  component: FileMentionBadge,
  decorators: [
    (Story) => (
      <div className="p-4 text-sm">
        <p>
          Inline mention: <Story />
        </p>
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof FileMentionBadge>

export const File: Story = {
  args: { label: 'src/index.ts', isDirectory: false, isArtifact: false },
}

export const Directory: Story = {
  args: { label: 'src/components/', isDirectory: true, isArtifact: false },
}

export const Artifact: Story = {
  args: { label: 'research.md', isDirectory: false, isArtifact: true },
}

export const LongPath: Story = {
  args: {
    label: 'apps/riptide-ui/src/components/very/deeply/nested/component.tsx',
    isDirectory: false,
    isArtifact: false,
  },
}
