import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type {
	ArtifactDeliveryCapability,
	ArtifactDeliveryMode,
	ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { CircleCheckBig, Clipboard, MessageSquareText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { useDeliveryPreference } from '@/components/comment-delivery/useDeliveryPreference'
import type { HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { hotkeysCatalog } from '@/hotkeysCatalog'

import { useBulkArtifactDelivery } from './useBulkArtifactDelivery'

export interface ArtifactBulkDeliveryModel {
	capability: ArtifactDeliveryCapability
	mode: ArtifactDeliveryMode
	count: number
	pending: boolean
	error: string | null
	setMode: (mode: ArtifactDeliveryMode) => void
	execute: (mode: ArtifactDeliveryMode) => void
	copy: () => void
	resolveSentComments: (() => void) | null
}

export function useCommentSendCommandPaletteActionsAndHotkeys({
	artifactId,
	fileName,
	threads,
	capability,
	resolveBatch,
	hotkeyScopes,
	enabled = true,
}: {
	artifactId: string
	fileName: string
	threads: readonly ProjectedCommentThread[]
	capability: ArtifactDeliveryCapability
	resolveBatch: (input: { artifactId: string; rootCommentIds: string[] }) => Promise<unknown>
	hotkeyScopes: HotkeyScope[]
	enabled?: boolean
}): ArtifactBulkDeliveryModel {
	const [mode, setMode] = useDeliveryPreference()
	const delivery = useBulkArtifactDelivery({ artifactId, fileName, threads, capability, resolveBatch })
	const [resolvingAll, setResolvingAll] = useState(false)

	const copy = useCallback(() => void delivery.copy(), [delivery])
	const execute = useCallback(
		(nextMode: ArtifactDeliveryMode) => {
			if (delivery.pending) return
			if (capability.kind === 'copy') {
				void delivery.copy()
				return
			}
			void delivery.deliver(nextMode)
		},
		[capability.kind, delivery],
	)
	const send = useCallback(() => execute('send'), [execute])
	const sendAndResolve = useCallback(() => execute('send-and-resolve'), [execute])
	const executeDefault = useCallback(() => execute(mode), [execute, mode])
	const resolveAll = useCallback(() => {
		if (resolvingAll || threads.length === 0) return
		setResolvingAll(true)
		void resolveBatch({ artifactId, rootCommentIds: threads.map((thread) => thread.root.id) })
			.catch(() => toast.error('Failed to resolve all comments', { duration: 5000, closeButton: true }))
			.finally(() => setResolvingAll(false))
	}, [artifactId, resolveBatch, resolvingAll, threads])

	useCommandPaletteAction({
		id: 'send-all-artifact-comments-to-agent',
		label: capability.kind === 'copy' ? 'Copy All Comments for Agent' : 'Send All Comments to Agent',
		icon: capability.kind === 'copy' ? Clipboard : MessageSquareText,
		shortcut: hotkeysCatalog.artifacts.shortcuts.sendComments.display,
		enabled: enabled && threads.length > 0 && !delivery.pending,
		onSelect: capability.kind === 'copy' ? copy : send,
	})
	useCommandPaletteAction({
		id: 'send-all-artifact-comments-to-agent-and-resolve',
		label: 'Send All Comments to Agent and Resolve',
		icon: MessageSquareText,
		enabled: enabled && capability.kind !== 'copy' && threads.length > 0 && !delivery.pending,
		onSelect: sendAndResolve,
	})
	useCommandPaletteAction({
		id: 'resolve-all-artifact-comments',
		label: 'Resolve All Comments',
		icon: CircleCheckBig,
		enabled: enabled && threads.length > 0 && !resolvingAll,
		onSelect: resolveAll,
	})

	useHotkeys(
		'alt+c',
		(event) => {
			event.preventDefault()
			if (!delivery.pending && threads.length > 0) executeDefault()
		},
		{ scopes: hotkeyScopes, enabled: enabled && threads.length > 0 },
		[delivery.pending, enabled, executeDefault, threads.length],
	)

	return {
		capability,
		mode,
		count: threads.length,
		pending: delivery.pending,
		error: delivery.error,
		setMode,
		execute,
		copy,
		resolveSentComments: delivery.recoveryRootIds ? () => void delivery.resolveSentComments() : null,
	}
}
