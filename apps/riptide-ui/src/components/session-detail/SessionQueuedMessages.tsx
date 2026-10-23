import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { QueuedMessagesPane } from '@/components/QueuedMessagesPane'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSessionQueuedMessages } from '@/hooks/useSessionQueuedMessages'
import { captureException } from '@/integrations/sentry/sentry'
import { getSenderPresentation } from '@/lib/sender-presentation'
import { useRiptideApi } from '@/orpc/client'

/**
 * The queued-messages pane above the continue-session editor. Owns the queue
 * data, the open/collapsed state, and the batch-delivery preference mutation.
 * Renders nothing when the queue is empty.
 */
export function SessionQueuedMessages() {
	const { sessionId, sessionActions, sendControls, canManageSession, canSendPrompt, conversation } =
		useSessionDetail()
	const { queryClient: api } = useRiptideApi()
	const { membersMap } = useOrgMembers()

	const { messages, count } = useSessionQueuedMessages(sessionId)
	const [isOpen, setIsOpen] = useState(true)

	const preferBatchQueueDelivery = useSettingsStore((s) => s.preferBatchQueueDelivery)
	const setPreferBatchQueueDelivery = useSettingsStore((s) => s.setPreferBatchQueueDelivery)
	const applyServerSettings = useSettingsStore((s) => s.applyServerSettings)
	const markMutationInFlight = useSettingsStore((s) => s.markMutationInFlight)

	const updateSettingsMutation = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onSuccess: (data) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				applyServerSettings(data)
			},
			onError: (error) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				if (isDefinedError(error) && error.code === 'FEATURE_DISABLED_BY_ORG') {
					toast.error('Feature disabled by organization')
				}
			},
		}),
	)

	const handlePreferBatchQueueDeliveryToggle = (checked: boolean) => {
		setPreferBatchQueueDelivery(checked)
		markMutationInFlight()
		updateSettingsMutation.mutate({ preferBatchQueueDelivery: checked })
	}

	// Edits race against delivery: if the message was already sent, the server
	// rejects with QUEUED_MESSAGE_UPDATE_FAILED and the optimistic edit rolls back.
	const { mutate: updateQueuedMessage } = useOptimisticMutation(sessionActions.updateQueuedMessage, {
		onError: (err) => {
			if (isDefinedError(err) && (err as { code?: string }).code === 'QUEUED_MESSAGE_UPDATE_FAILED') {
				toast.error('That message was already sent and can no longer be edited')
				return
			}
			toast.error('Could not update queued message')
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { error_type: 'queued_message_update_failed' },
				extra: { sessionId },
			})
		},
	})
	const { mutate: deleteQueuedMessage } = useOptimisticMutation(sessionActions.deleteQueuedMessage, {
		onError: (err) => {
			toast.error('Could not remove queued message')
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { error_type: 'queued_message_delete_failed' },
				extra: { sessionId },
			})
		},
	})

	const handleDelete = canSendPrompt
		? (id: string) => deleteQueuedMessage({ sessionId, queuedMessageId: id })
		: () => {}
	const handleSendNow = canSendPrompt ? sendControls.handleSendNow : () => {}
	const handleEdit = canSendPrompt
		? (id: string, text: string) => updateQueuedMessage({ sessionId, queuedMessageId: id, text })
		: () => {}
	const handleBatchPreferenceChange = canManageSession ? handlePreferBatchQueueDeliveryToggle : () => {}
	const handleToggle = () => setIsOpen((open) => !open)
	const queueCapabilities = {
		canDelete: canSendPrompt,
		canSendNow: canSendPrompt,
		canEdit: canSendPrompt,
		canChangeBatchPreference: canManageSession,
	}

	if (count === 0) return null

	return (
		<div className="shrink-0 pt-2">
			<QueuedMessagesPane
				messages={messages.map((message) => ({
					...message,
					sender: message.user_id ? getSenderPresentation(membersMap.get(message.user_id)) : undefined,
				}))}
				showSenderNames={conversation.showSenderNames}
				isOpen={isOpen}
				onToggle={handleToggle}
				preferBatchQueueDelivery={preferBatchQueueDelivery}
				capabilities={queueCapabilities}
				onPreferBatchQueueDeliveryChange={handleBatchPreferenceChange}
				onDelete={handleDelete}
				onSendNow={handleSendNow}
				onEdit={handleEdit}
			/>
		</div>
	)
}
