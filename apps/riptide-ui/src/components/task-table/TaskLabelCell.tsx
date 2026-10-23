import { SessionLabelBadge } from '@humanlayer/ui/components/session-label-badge'
import type { FC } from 'react'

import { useTaskMostProgressedLabel } from '@/hooks/live-queries/useTaskMostProgressedLabel'

export interface TaskLabelCellProps {
	taskId: string
}

/**
 * Renders the most progressed RPI label for a task.
 * Returns empty cell if task has no labeled sessions.
 */
export const TaskLabelCell: FC<TaskLabelCellProps> = ({ taskId }) => {
	const { label } = useTaskMostProgressedLabel(taskId)

	if (!label) {
		return null
	}

	return <SessionLabelBadge label={label} />
}
