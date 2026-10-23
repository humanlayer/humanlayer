import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { requestResponseContinuation } from '@/actions/sessions'
import type { RunningSubAgent } from '@/components/InterruptConfirmDialog'
import { useSyncInternal } from '@/components/providers/SyncProvider'
import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { type ModelType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { getResponseEditorContentPort, type ResponseEditorSubmission } from '@/hooks/use-response-editor-content-port'
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation'
import type { useSessionActions } from '@/hooks/useSessionActions'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'
import { recordSendScrollDiagnostic, startSendScrollDiagnostic } from '@/lib/send-scroll-diagnostics'
import { useRiptideApi } from '@/orpc/client'
import type { RiptideApiClient } from '@/orpc/client'

import type { SessionDetailSession } from './useSessionDetailData'

export type PendingInterruptIntent =
	| { kind: 'editor_interrupt_and_send' }
	| { kind: 'queued_send_now'; queuedMessageId: string }

export async function requestInterruptAndSendAndAwaitSync({
	sessionId,
	text,
	sharedSubmission,
	request,
	confirmTx,
}: {
	sessionId: string
	text: string
	sharedSubmission?: ResponseEditorSubmission
	request: RiptideApiClient['sessions']['v2']['continue']
	confirmTx: (transactionId: string) => Promise<void>
}) {
	const response = await requestResponseContinuation({
		input: { sessionId, text, intent: 'interrupt_and_send' },
		request,
		sharedSubmission,
	})
	if (response.kind === 'queued' && !sharedSubmission) throw new Error('interrupt and send unexpectedly queued')
	await confirmTx(response.transactionId)
	return response
}

export function clearLocalInterruptResponse(
	sessionId: string,
	editor: import('@tiptap/core').Editor | null | undefined,
) {
	const mode = getResponseEditorContentPort(editor)?.mode
	if (!mode || mode === 'local') editor?.commands.clearContent()
	useDraftsStore.getState().clearDraft(sessionId)
}

/**
 * Message delivery controls for the session detail page: continue-session
 * submit, interrupt (with sub-agent confirmation gating), interrupt-and-send,
 * and sending queued messages immediately.
 *
 * `pendingInterruptIntent` state is owned by the page because it feeds
 * `isModalOpen`, which other hooks need before this one can run.
 */
export function useSessionSendControls({
	sessionId,
	session,
	sessionActions,
	continueEditorRef,
	jumpToBottom,
	runningSubAgents,
	pendingInterruptIntent,
	setPendingInterruptIntent,
}: {
	sessionId: string
	session: SessionDetailSession | undefined
	sessionActions: ReturnType<typeof useSessionActions>
	continueEditorRef: RefObject<RichTextEditorRef | null>
	jumpToBottom: () => void
	runningSubAgents: RunningSubAgent[]
	pendingInterruptIntent: PendingInterruptIntent | null
	setPendingInterruptIntent: Dispatch<SetStateAction<PendingInterruptIntent | null>>
}) {
	const { client } = useRiptideApi()
	const { confirmTx } = useSyncInternal()
	const confirmBeforeInterruptingSubAgents = useSettingsStore((s) => s.confirmBeforeInterruptingSubAgents)

	const [isSubmittingContinue, setIsSubmittingContinue] = useState(false)

	const handleSendQueuedMessageNowError = useCallback(
		(err: unknown) => {
			if (isDefinedError(err) && (err as { code?: string }).code === 'QUEUED_MESSAGE_SEND_FAILED') {
				toast.error('That message was already delivered')
			} else {
				toast.error('Could not send queued message')
			}
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { error_type: 'send_queued_now_failed' },
				extra: { sessionId },
			})
		},
		[sessionId],
	)
	const { mutate: sendQueuedMessageNow } = useOptimisticMutation(sessionActions.sendQueuedMessageNow, {
		onError: handleSendQueuedMessageNowError,
	})

	const requestInterruptAndSend = useCallback(
		({ text, sharedSubmission }: { text: string; sharedSubmission?: ResponseEditorSubmission }) =>
			requestInterruptAndSendAndAwaitSync({
				sessionId,
				text,
				request: client.sessions.v2.continue,
				sharedSubmission,
				confirmTx: confirmTx.sessions,
			}),
		[client.sessions.v2, confirmTx.sessions, sessionId],
	)
	const handleInterruptAndSendSuccess = useCallback(
		(_response: unknown, variables: { sharedSubmission?: ResponseEditorSubmission }) => {
			if (variables.sharedSubmission) return
			clearLocalInterruptResponse(sessionId, continueEditorRef.current?.editor)
		},
		[sessionId, continueEditorRef],
	)
	const handleInterruptAndSendError = useCallback(
		(err: unknown) => {
			toast.error('Failed to interrupt and send')
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { error_type: 'interrupt_and_send_failed' },
				extra: { sessionId },
			})
		},
		[sessionId],
	)
	const { mutate: interruptAndSendMessage } = useMutation({
		mutationFn: requestInterruptAndSend,
		onSuccess: handleInterruptAndSendSuccess,
		onError: handleInterruptAndSendError,
	})

	// Handle continue session submit (internal - use handleSubmitWithApprovalCheck for ContinueSessionInput)
	const handleContinueSubmit = useCallback(
		async (params: {
			text: string
			sharedSubmission?: ResponseEditorSubmission
			model: ModelType
			permissionsMode: 'default' | 'accept_edits' | 'bypass' | 'auto'
		}) => {
			if (!session) return

			startSendScrollDiagnostic(session.id)
			setIsSubmittingContinue(true)
			const messageId = uuidv7()
			const eventId = uuidv7()
			recordSendScrollDiagnostic('before_optimistic_mutation')
			const transaction = sessionActions.continueV2({
				sessionId: session.id,
				messageId,
				eventId,
				text: params.text,
				intent: 'send',
				sharedSubmission: params.sharedSubmission,
			})
			recordSendScrollDiagnostic('after_optimistic_mutation')

			// Snap to the optimistically-inserted user message at the new tail. The optimistic row
			// is already in rootEvents (synchronous onMutate), so jumpToBottom's rAF retries land
			// on the just-inserted row.
			jumpToBottom()
			recordSendScrollDiagnostic('direct_jump_returned')

			void transaction.isPersisted.promise.finally(() => {
				recordSendScrollDiagnostic('optimistic_transaction_settled')
				setIsSubmittingContinue(false)
			})
		},
		[session, sessionActions, jumpToBottom],
	)

	// Handle interrupt session
	const handleInterrupt = useCallback(
		async (message?: string) => {
			if (!session) return

			const transaction = sessionActions.interruptSession({
				sessionId: session.id,
				message,
			})

			// Interrupt-with-text counts as "sending a message" per CORE-1118. interruptSession does
			// not optimistically insert an event row, so this lands on the previous tail; sticky-bottom
			// re-engages once Electric delivers the actual user message.
			if (message && message.length > 0) {
				jumpToBottom()
			}

			// NO toast on success - optimistic update instantly reflects the change
			// Only toast on failure
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to interrupt session')
				logger.error('Interrupt session error:', error)
				captureException(error, {
					extra: { action: 'interruptSession', sessionId: session.id, taskId: session.task_id },
				})
			})
		},
		[session, sessionActions, jumpToBottom],
	)

	// Refs for values that change frequently (every event) to keep handleInterruptWithConfirmation stable.
	// Without refs, the callback would be recreated on every agentGroups change, causing ContinueSessionInput
	// to re-render on every event — a behavioral change from main where onInterrupt was very stable.
	const runningSubAgentsRef = useRef(runningSubAgents)
	runningSubAgentsRef.current = runningSubAgents
	const confirmBeforeInterruptingSubAgentsRef = useRef(confirmBeforeInterruptingSubAgents)
	confirmBeforeInterruptingSubAgentsRef.current = confirmBeforeInterruptingSubAgents

	// Gate function that decides whether to show interrupt confirmation dialog
	// Returns false to signal ContinueSessionInput to preserve editor text
	const handleInterruptWithConfirmation = useCallback(
		(message?: string): boolean | undefined => {
			if (message && runningSubAgentsRef.current.length > 0 && confirmBeforeInterruptingSubAgentsRef.current) {
				setPendingInterruptIntent({ kind: 'editor_interrupt_and_send' })
				return false
			}
			if (message) {
				const port = getResponseEditorContentPort(continueEditorRef.current?.editor)
				interruptAndSendMessage({
					text: message,
					sharedSubmission: port?.mode === 'shared' ? port.beginSubmission() : undefined,
				})
				jumpToBottom()
				return false
			}
			void handleInterrupt(message)
		},
		[handleInterrupt, interruptAndSendMessage, jumpToBottom, setPendingInterruptIntent, continueEditorRef],
	)

	const handleSendNow = useCallback(
		(messageId: string) => {
			if (runningSubAgentsRef.current.length > 0 && confirmBeforeInterruptingSubAgentsRef.current) {
				setPendingInterruptIntent({ kind: 'queued_send_now', queuedMessageId: messageId })
				return
			}

			sendQueuedMessageNow({ sessionId, queuedMessageId: messageId })
		},
		[sendQueuedMessageNow, sessionId, setPendingInterruptIntent],
	)

	// Confirm callback — executes the deferred interrupt intent.
	const handleInterruptConfirm = useCallback(() => {
		const intent = pendingInterruptIntent
		setPendingInterruptIntent(null)
		if (!intent) return

		if (intent.kind === 'queued_send_now') {
			sendQueuedMessageNow({ sessionId, queuedMessageId: intent.queuedMessageId })
			return
		}

		const editor = continueEditorRef.current?.editor
		const port = getResponseEditorContentPort(editor)
		if (port && (port.mode === 'denial' || port.mode === 'fork' || !editor?.isEditable)) return
		const message = port?.mode === 'shared' ? port.serialize() : editor?.getText().trim()
		if (!message) return
		interruptAndSendMessage({
			text: message,
			sharedSubmission: port?.mode === 'shared' ? port.beginSubmission() : undefined,
		})
		jumpToBottom()
	}, [
		interruptAndSendMessage,
		jumpToBottom,
		pendingInterruptIntent,
		sendQueuedMessageNow,
		sessionId,
		setPendingInterruptIntent,
		continueEditorRef,
	])

	// Cancel callback — close dialog, text stays in editor
	const handleInterruptCancel = useCallback(() => {
		setPendingInterruptIntent(null)
	}, [setPendingInterruptIntent])

	return {
		isSubmittingContinue,
		handleContinueSubmit,
		handleInterrupt,
		handleInterruptWithConfirmation,
		handleInterruptConfirm,
		handleInterruptCancel,
		handleSendNow,
	}
}
