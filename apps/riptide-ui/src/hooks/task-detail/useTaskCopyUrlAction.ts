import { Link } from 'lucide-react'
import { useCallback } from 'react'

import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copyTaskDeepLink } from '@/utils/sharing-links'

/**
 * Registers the task-detail "Copy Task URL" command palette action.
 *
 * Mirrors `useTaskArchiveAction`, but is always enabled — the provider only
 * renders children once the task exists, and copying the URL requires no
 * edit permission.
 */
export function useTaskCopyUrlAction({ taskId }: { taskId: string }): void {
	const handleCopyTaskUrl = useCallback(() => {
		void copyTaskDeepLink(taskId)
	}, [taskId])

	useCommandPaletteAction({
		id: 'copy-task-url',
		label: 'Copy Task URL',
		icon: Link,
		shortcut: hotkeysCatalog.taskDetail.shortcuts.copyPrimaryUrl.display,
		onSelect: handleCopyTaskUrl,
	})
}
