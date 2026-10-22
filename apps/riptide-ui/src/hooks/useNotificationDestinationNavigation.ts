import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import type { HorizontalTabNotificationDestination } from '@/components/horizontal-tabs/horizontalTabNotificationDestination'
import { useHorizontalTabs } from '@/components/horizontal-tabs/HorizontalTabsProvider'

export function useNotificationDestinationNavigation(): (destination: HorizontalTabNotificationDestination) => void {
	const navigate = useNavigate()
	const { isAvailable, openNotificationDestination } = useHorizontalTabs()

	return useCallback(
		(destination) => {
			if (isAvailable) {
				openNotificationDestination(destination)
				return
			}

			if (destination.kind === 'session') {
				navigate({ to: '/sessions/$sessionId', params: { sessionId: destination.sessionId } })
				return
			}

			navigate({
				to: '/tasks/$taskId',
				params: { taskId: destination.taskId },
				search: { focus: 'workspace' },
			})
		},
		[isAvailable, navigate, openNotificationDestination],
	)
}
