import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type {
	ArtifactDeliveryCapability,
	ArtifactDeliveryMode,
	ArtifactDeliveryResult,
} from '@humanlayer/ui/artifact-viewer-v2'
import { exportDiffComments } from '@humanlayer/ui/lib/diff-review/export-diff-comments'
import type { ProjectedDiffThread } from '@humanlayer/ui/lib/diff-review/project-diff-comments'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { uuidv7 } from 'uuidv7'

import { useArtifactDeliveryCapability } from '@/components/comment-delivery/useArtifactDeliveryCapability'
import { useDeliveryPreference } from '@/components/comment-delivery/useDeliveryPreference'
import {
	createSessionEditorDeliveryPort,
	type SessionEditorDeliveryPort,
} from '@/components/diffs/delivery/session-editor-delivery-port'
import { useSyncInternal } from '@/components/providers/SyncProvider'
import type { HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useRiptideApi } from '@/orpc/client'

import { executeDiffFeedbackDelivery } from './executeDiffFeedbackDelivery'
import { exportDiffFeedback } from './export-diff-feedback'

export type DiffFeedbackDeliveryTarget =
	| { readonly kind: 'session'; readonly sessionId: string }
	| { readonly kind: 'task' }

export interface DiffFeedbackDeliveryModel {
	readonly capability: ArtifactDeliveryCapability
	readonly mode: ArtifactDeliveryMode
	readonly count: number
	readonly pending: boolean
	readonly error: string | null
	readonly setMode: (mode: ArtifactDeliveryMode) => void
	readonly deliverAll: (mode: ArtifactDeliveryMode) => void
	readonly copyAll: () => void
	readonly deliverThread: (rootCommentId: string, mode: ArtifactDeliveryMode) => void
	readonly resolveSentComments: (() => void) | null
}

export function useDiffFeedbackDelivery({
	taskId,
	threads,
	target,
	hotkeyScopes,
}: {
	taskId: string
	threads: readonly ProjectedDiffThread[]
	target: DiffFeedbackDeliveryTarget
	hotkeyScopes: readonly HotkeyScope[]
}): DiffFeedbackDeliveryModel {
	const { client } = useRiptideApi()
	const { confirmTx } = useSyncInternal()
	const navigate = useNavigate()
	const [mode, setMode] = useDeliveryPreference()
	const sessionId = target.kind === 'session' ? target.sessionId : undefined
	const sessionCapability = useArtifactDeliveryCapability({ sessionId, taskId })
	const capability: ArtifactDeliveryCapability =
		target.kind === 'task' ? { kind: 'send', sessionId: 'task-diff-draft' } : sessionCapability
	const editorPort = useMemo<SessionEditorDeliveryPort | null>(
		() => (sessionId ? createSessionEditorDeliveryPort(sessionId) : null),
		[sessionId],
	)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [recoveryRootIds, setRecoveryRootIds] = useState<readonly string[] | null>(null)
	const pendingRef = useRef(false)
	const openThreads = threads.filter((thread) => !thread.root.is_deleted && !thread.root.is_resolved)

	const resolveBatch = useCallback(
		async (rootCommentIds: readonly string[]) => {
			const response = await client.diffComments.resolveBatch({ taskId, rootCommentIds: [...rootCommentIds] })
			await confirmTx.diffComments(response.transactionId)
		},
		[client.diffComments, confirmTx.diffComments, taskId],
	)

	const execute = useCallback(
		async (
			selectedThreads: readonly ProjectedDiffThread[],
			selectedMode: ArtifactDeliveryMode,
			forceCopy = false,
		): Promise<ArtifactDeliveryResult> => {
			if (pendingRef.current) return { kind: 'failed', message: 'A delivery operation is already pending.' }
			pendingRef.current = true
			setPending(true)
			setError(null)
			setRecoveryRootIds(null)
			try {
				const comments = exportDiffComments(selectedThreads)
				if (comments.rootCommentIds.length === 0) {
					setError('There is no open diff feedback to deliver.')
					return { kind: 'failed', message: 'There is no open diff feedback to deliver.' }
				}

				if (target.kind === 'task') {
					await navigate({
						to: '/sessions/draft',
						search: {
							taskId,
							slashCommand: '/rpi:iterate-implementation',
							prompt: comments.xml,
							diffCommentDeliveryMode: selectedMode,
							diffCommentRootIds: [...comments.rootCommentIds],
						},
					})
					return { kind: 'delivered' }
				}

				const capture = editorPort?.capture() ?? { id: uuidv7(), text: '' }
				const feedback = exportDiffFeedback(capture.text, comments)
				if (forceCopy || capability.kind === 'copy') {
					try {
						await navigator.clipboard.writeText(feedback.text)
						return { kind: 'copied' }
					} catch {
						setError('Diff feedback could not be copied.')
						return { kind: 'failed', message: 'Diff feedback could not be copied.' }
					}
				}

				const result = await executeDiffFeedbackDelivery({
					intent: capability.kind === 'queue' ? 'queue' : 'send',
					mode: selectedMode,
					feedback,
					editorCapture: capture,
					dispatch: (intent, text) =>
						client.sessions.v2.continue({
							sessionId: target.sessionId,
							messageId: uuidv7(),
							eventId: uuidv7(),
							text,
							intent,
						}),
					confirm: async (acceptance) => {
						if (acceptance.kind === 'queued') await confirmTx.queuedMessages(acceptance.transactionId)
						else await confirmTx.sessions(acceptance.transactionId)
					},
					clearEditorIfUnchanged: (captureId) => editorPort?.clearIfUnchanged(captureId),
					resolveBatch,
				})
				if (result.kind === 'failed') setError(result.message)
				if (result.kind === 'delivered-resolution-failed') {
					setRecoveryRootIds(result.rootCommentIds)
					setError('Sent, but diff comments could not be resolved.')
				}
				return result
			} finally {
				pendingRef.current = false
				setPending(false)
			}
		},
		[
			capability.kind,
			client.sessions.v2,
			confirmTx.queuedMessages,
			confirmTx.sessions,
			editorPort,
			navigate,
			resolveBatch,
			target,
			taskId,
		],
	)

	const deliverAll = useCallback(
		(selectedMode: ArtifactDeliveryMode) => {
			void execute(openThreads, selectedMode)
		},
		[execute, openThreads],
	)
	const copyAll = useCallback(() => {
		void execute(openThreads, mode, true)
	}, [execute, mode, openThreads])
	const deliverThread = useCallback(
		(rootCommentId: string, selectedMode: ArtifactDeliveryMode) => {
			const thread = openThreads.find((candidate) => candidate.root.id === rootCommentId)
			if (thread) void execute([thread], selectedMode)
		},
		[execute, openThreads],
	)
	const resolveSentComments = useCallback(() => {
		const ids = recoveryRootIds
		if (!ids || pendingRef.current) return
		pendingRef.current = true
		setPending(true)
		void resolveBatch(ids)
			.then(() => {
				setRecoveryRootIds(null)
				setError(null)
			})
			.catch(() => setError('Sent, but diff comments could not be resolved.'))
			.finally(() => {
				pendingRef.current = false
				setPending(false)
			})
	}, [recoveryRootIds, resolveBatch])

	useHotkeys(
		'alt+c',
		(event) => {
			event.preventDefault()
			if (!pendingRef.current && openThreads.length > 0) deliverAll(mode)
		},
		{ scopes: [...hotkeyScopes], enabled: openThreads.length > 0 },
		[deliverAll, mode, openThreads.length],
	)

	return {
		capability,
		mode,
		count: openThreads.length,
		pending,
		error,
		setMode,
		deliverAll,
		copyAll,
		deliverThread,
		resolveSentComments: recoveryRootIds ? resolveSentComments : null,
	}
}
