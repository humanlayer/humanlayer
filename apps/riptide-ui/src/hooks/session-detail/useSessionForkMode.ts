import { LAUNCHABLE_CODING_AGENT_VALUES } from '@humanlayer/schemas/coding-agent'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { useNavigate } from '@tanstack/react-router'
import type { Content } from '@tiptap/core'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { getResponseEditorContentPort } from '@/hooks/use-response-editor-content-port'
import type { useSessionActions } from '@/hooks/useSessionActions'
import { isForkExcludedMessage } from '@/utils/sidebar-transforms'

import type { SessionDetailSession } from './useSessionDetailData'

/**
 * Fork mode for the session detail page: fork selector state, the forkable
 * message list, the fork-confirm flow (creates and navigates to the new
 * session). Keyboard bindings live in useSessionForkHotkeys.
 */
export function useSessionForkMode({
	sessionId,
	session,
	events,
	continueEditorRef,
	sessionActions,
	selectedArtifactId,
	closeArtifactPanel,
}: {
	sessionId: string
	session: SessionDetailSession | undefined
	events: ConversationEvent[]
	continueEditorRef: RefObject<RichTextEditorRef | null>
	sessionActions: {
		forkSession: (input: Parameters<ReturnType<typeof useSessionActions>['forkSession']>[0]) => unknown
	}
	selectedArtifactId: string | null
	closeArtifactPanel: () => void
}) {
	const navigate = useNavigate()

	// Fork mode state
	const [isForkMode, setIsForkMode] = useState(false)
	const [forkContent, setForkContent] = useState<Content | null>(null)
	const [selectedForkEventId, setSelectedForkEventId] = useState<string | null>(null)
	const [archiveOnFork, setArchiveOnFork] = useState(false)
	// Whether to show the fork selector panel in the sidebar (only via cmd+y or prompt box fork button)
	const [showForkSelector, setShowForkSelector] = useState(false)

	// The API forks only the agents the daemon launches: an opencode or pi session runs on its own host.
	const canFork =
		session !== undefined && LAUNCHABLE_CODING_AGENT_VALUES.some((agent) => agent === session.coding_agent)

	// Compute user message count for enabling fork button
	const userMessageCount = useMemo(
		() => events.filter((e) => e.role === 'user' && !e.parentToolUseId).length,
		[events],
	)

	// ID of the first user message — forking from it is not allowed
	const firstUserMessageId = useMemo(
		() => events.find((e) => e.role === 'user' && !e.parentToolUseId && e.eventType === 'message')?.id ?? null,
		[events],
	)

	// Compute forkable messages — root messages (no parentToolUseId, event_type 'message')
	const forkableMessages = useMemo(
		() =>
			events
				.filter((e) => !e.parentToolUseId && e.eventType === 'message' && !isForkExcludedMessage(e.content))
				.map((e) => ({
					id: e.id,
					role: e.role as 'user' | 'assistant',
					content: e.content ?? null,
					createdAt: e.createdAt,
				})),
		[events],
	)

	// Derive the selected fork message content for status bar display
	const forkedFromMessage = useMemo(() => {
		if (!isForkMode || !selectedForkEventId) return null
		const msg = forkableMessages.find((m) => m.id === selectedForkEventId)
		if (!msg?.content) return null
		return msg.content.length > 80 ? `${msg.content.substring(0, 80)}...` : msg.content
	}, [isForkMode, selectedForkEventId, forkableMessages])

	const handleForkConfirm = useCallback(
		(text: string) => {
			if (!selectedForkEventId || !text.trim() || !session) return
			const newSessionId = uuidv7()
			const newEventId = uuidv7()
			try {
				sessionActions.forkSession({
					id: newSessionId,
					eventId: newEventId,
					sourceSessionId: sessionId,
					forkAtEventId: selectedForkEventId,
					text: text.trim(),
					title: null,
					archiveSource: archiveOnFork,
					sourceSession: {
						task_id: session.task_id,
						working_directory: session.working_directory,
						host_id: session.host_id,
						coding_agent: session.coding_agent,
						provider: session.provider,
						model: session.model,
						permissions_mode: session.permissions_mode as 'default' | 'accept_edits' | 'bypass',
						resource_owner_user_id: session.resource_owner_user_id,
					},
				})
				// Reset fork state
				setIsForkMode(false)
				setSelectedForkEventId(null)
				setArchiveOnFork(false)
				setShowForkSelector(false)
				// Navigate to the new session
				navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
			} catch {
				toast.error('Failed to fork the session')
				navigate({ to: '/sessions/$sessionId', params: { sessionId } })
			}
		},
		[selectedForkEventId, session, sessionId, archiveOnFork, sessionActions, navigate],
	)

	const handleForkCancel = useCallback(() => {
		setIsForkMode(false)
		setSelectedForkEventId(null)
		setArchiveOnFork(false)
		setShowForkSelector(false)
	}, [])

	const prefillForkEditorFromEvent = useCallback(
		(eventId: string) => {
			const message = forkableMessages.find((m) => m.id === eventId)
			if (!message?.content) return

			const editor = continueEditorRef.current?.editor
			setForkContent(message.content)
			if (!editor) return
			const port = getResponseEditorContentPort(editor)
			if (port?.mode === 'shared' || port?.mode === 'fork' || port?.mode === 'denial') return

			editor.commands.setContent(message.content)
		},
		[forkableMessages, continueEditorRef],
	)

	const handleEnterForkMode = useCallback(() => {
		if (!canFork || userMessageCount < 2) return
		// Close artifact panel if open so the fork selector can take the sidebar
		if (selectedArtifactId) {
			closeArtifactPanel()
		}
		setIsForkMode(true)
		setShowForkSelector(true)
		// Default-select the last user message
		const lastUserMessage = [...forkableMessages].reverse().find((m) => m.role === 'user')
		if (lastUserMessage) {
			setSelectedForkEventId(lastUserMessage.id)
			prefillForkEditorFromEvent(lastUserMessage.id)
		}
	}, [
		canFork,
		userMessageCount,
		forkableMessages,
		selectedArtifactId,
		closeArtifactPanel,
		prefillForkEditorFromEvent,
	])

	const handleForkFromMessage = useCallback(
		(eventId: string) => {
			setIsForkMode(true)
			setSelectedForkEventId(eventId)
			prefillForkEditorFromEvent(eventId)
			continueEditorRef.current?.editor?.chain().focus().selectAll().run()
		},
		[prefillForkEditorFromEvent, continueEditorRef],
	)

	const handleForkSelectEvent = useCallback(
		(eventId: string) => {
			setSelectedForkEventId(eventId)
			prefillForkEditorFromEvent(eventId)
			useFocusStore.getState().setFocusedEventId(eventId, 'mouse')
			// Scroll to the selected message in the conversation stream
			const element = document.querySelector(`[data-event-id="${eventId}"]`)
			element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
		},
		[prefillForkEditorFromEvent],
	)

	const handleForkSelectionConfirm = useCallback(() => {
		continueEditorRef.current?.editor?.chain().focus().selectAll().run()
	}, [continueEditorRef])

	return {
		canFork,
		forkContent,
		setForkContent,
		isForkMode,
		showForkSelector,
		selectedForkEventId,
		archiveOnFork,
		setArchiveOnFork,
		userMessageCount,
		firstUserMessageId,
		forkableMessages,
		forkedFromMessage,
		handleForkConfirm,
		handleForkCancel,
		handleEnterForkMode,
		handleForkFromMessage,
		handleForkSelectEvent,
		handleForkSelectionConfirm,
	}
}
