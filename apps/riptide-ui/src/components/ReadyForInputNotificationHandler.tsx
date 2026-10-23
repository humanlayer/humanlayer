import type { Session } from '@humanlayer/db/tables/sessions'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { findAutoAdvanceField } from '@/lib/auto-advance-policy'
import { logger } from '@/lib/logger'

type SessionChangeMessage = {
	type: 'insert' | 'update' | 'delete'
	value: Session
	previousValue?: Session
}

export function ReadyForInputNotificationHandler() {
	const { sessionsCollection, tasksCollection, taskUserSettingsCollection } = useSync()
	const { user } = useAuth()

	useEffect(() => {
		const subscription = sessionsCollection.subscribeChanges(
			(changes) => {
				for (const change of changes as SessionChangeMessage[]) {
					if (
						change.type !== 'update' ||
						change.previousValue?.status === 'ready_for_input' ||
						change.value.status !== 'ready_for_input'
					) {
						continue
					}
					const session = change.value
					if (user?.id && session.created_by !== user.id) continue

					const taskId = session.task_id
					const autoAdvanceField = taskId ? findAutoAdvanceField(session.labels) : undefined
					const task = taskId && autoAdvanceField ? tasksCollection.state.get(taskId) : undefined
					if (task && autoAdvanceField) {
						const isOwner = task.resource_owner_user_id === user?.id
						const userSettings = isOwner
							? undefined
							: taskUserSettingsCollection.toArray.find(
									(settings) => settings.task_id === taskId && settings.user_id === user?.id,
								)
						if (userSettings?.[autoAdvanceField] ?? task[autoAdvanceField]) {
							logger.debug(
								{ sessionId: session.id, autoAdvanceField },
								'Skipping sound - auto-advance enabled',
							)
							continue
						}
					}

					const settings = useSettingsStore.getState()
					if (settings.notificationSoundsEnabled) {
						const audio = new Audio('/sounds/notification.mp3')
						audio.volume = settings.notificationVolume
						audio.play().catch(() => {})
					}
				}
			},
			{ includeInitialState: false },
		)

		return () => subscription.unsubscribe()
	}, [sessionsCollection, tasksCollection, taskUserSettingsCollection, user?.id])

	return null
}
