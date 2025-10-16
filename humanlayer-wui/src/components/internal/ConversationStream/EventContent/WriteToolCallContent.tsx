import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { DiffViewer } from './DiffViewer/DiffViewer'
import { getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'

export interface WriteToolInput {
  file_path: string
  content: string
}

interface WriteToolCallContentPropsWithSnapshot extends ToolCallContentProps<WriteToolInput> {
  fileSnapshot?: string
  isGroupItem?: boolean
}

export function WriteToolCallContent({
  toolInput,
  approvalStatus,
  fileSnapshot,
  isGroupItem,
}: WriteToolCallContentPropsWithSnapshot) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const isNewFile = !fileSnapshot || fileSnapshot.trim() === ''

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Write"
        description={isNewFile ? 'Create new file' : 'Overwrite file'}
        primaryParam={<span className="font-mono text-sm">{toolInput.file_path}</span>}
        nameColor={statusColor}
        status={<StatusBadge status={approvalStatus} />}
      />

      <div className="mt-2">
        <DiffViewer
          oldContent={fileSnapshot || ''}
          newContent={toolInput.content || ''}
          mode="unified"
          showFullFile={false}
        />
      </div>
    </div>
  )
}
