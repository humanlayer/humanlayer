import {
	decideCommentDeepLink,
	type CommentThreadBucket,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import type { ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { useMountEffect } from '@/hooks/useMountEffect'

/** Route-driven one-shot reveal the rail applies; `nonce` identity re-applies. */
export interface RailDeepLinkReveal {
	rootId: string
	replyId: string | null
	/** The target's completion bucket; the rail switches filters only when needed. */
	visibility: CommentThreadBucket
	nonce: number
}

export interface CommentDeepLinkModel {
	/** The pending rail-card reveal, or null. Cleared after the rail applies it. */
	railReveal: RailDeepLinkReveal | null
	/** The rail reports one applied reveal so a rail remount cannot repeat it. */
	clearRailReveal: () => void
	/** Copy a root thread's deep link to the authenticated artifact route. */
	copyThreadLink: (rootId: string) => void
	applyRailReveal: (reveal: Omit<RailDeepLinkReveal, 'nonce'>) => void
	railOpenRequested: boolean
	clearRailOpenRequest: () => void
	requestRailOpen: () => void
}

interface CommentDeepLinkState {
	railReveal: RailDeepLinkReveal | null
	nextNonce: number
	railOpenRequested: boolean
}

/**
 * Riptide Cloud route adapter for V2 comment deep links (Phase 4). Reads the
 * `comment` search param on the authenticated `/artifacts/$artifactId` route,
 * applies the shared pure reveal decision ONCE against the controller's current
 * projection, and then consumes the param (replace navigation). The anonymous
 * shared route never mounts this hook and stays comment-free. Unavailable IDs
 * (deleted, unknown, unauthorized) report one generic message without
 * displacing the viewer or leaking comment data.
 */
export function useCommentDeepLink({ artifactId }: { artifactId: string }): CommentDeepLinkModel {
	const router = useRouter()
	const [state, setState] = useState<CommentDeepLinkState>({
		railReveal: null,
		nextNonce: 1,
		railOpenRequested: false,
	})

	const copyThreadLink = (rootId: string) => {
		// Always link to the canonical authenticated artifact route so the target
		// reveals regardless of which surface hosted the copy.
		const location = router.buildLocation({
			to: '/artifacts/$artifactId',
			params: { artifactId },
			search: (previous: Record<string, unknown>) => ({ ...previous, comment: rootId }),
		})
		const url = `${window.location.origin}${location.href}`
		void navigator.clipboard.writeText(url).then(
			() => toast.success('Comment link copied', { duration: 3000, closeButton: true }),
			() => toast.error('Failed to copy comment link', { duration: 5000, closeButton: true }),
		)
	}

	const applyRailReveal = (reveal: Omit<RailDeepLinkReveal, 'nonce'>) =>
		setState((previous) => ({
			railReveal: { ...reveal, nonce: previous.nextNonce },
			nextNonce: previous.nextNonce + 1,
			railOpenRequested: true,
		}))

	return {
		railReveal: state.railReveal,
		clearRailReveal: () => setState((previous) => ({ ...previous, railReveal: null })),
		copyThreadLink,
		applyRailReveal,
		railOpenRequested: state.railOpenRequested,
		clearRailOpenRequest: () => setState((previous) => ({ ...previous, railOpenRequested: false })),
		requestRailOpen: () => setState((previous) => ({ ...previous, railOpenRequested: true })),
	}
}

export function CommentDeepLinkRouteApplier({
	artifactId,
	ready,
	viewMode,
	onViewModeChange,
	threads,
	resolvedThreads,
	revealInDocument,
	openCommentRail,
	applyRailReveal,
	requestRailOpen,
}: {
	artifactId: string
	ready: boolean
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	threads: ProjectedCommentThread[]
	resolvedThreads: ProjectedCommentThread[]
	revealInDocument: (rootId: string) => void
	openCommentRail: () => void
	applyRailReveal: CommentDeepLinkModel['applyRailReveal']
	requestRailOpen: CommentDeepLinkModel['requestRailOpen']
}) {
	const routeArtifactId = useParams({
		strict: false,
		select: (params) => (params as { artifactId?: string }).artifactId,
	})
	const commentParam = useSearch({
		strict: false,
		select: (search) => (search as { comment?: string }).comment,
	})
	if (!commentParam || !ready || routeArtifactId !== artifactId) return null
	return (
		<CommentDeepLinkEventWorker
			key={`${artifactId}:${commentParam}`}
			commentParam={commentParam}
			viewMode={viewMode}
			onViewModeChange={onViewModeChange}
			threads={threads}
			resolvedThreads={resolvedThreads}
			revealInDocument={revealInDocument}
			openCommentRail={openCommentRail}
			applyRailReveal={applyRailReveal}
			requestRailOpen={requestRailOpen}
		/>
	)
}

function CommentDeepLinkEventWorker({
	commentParam,
	viewMode,
	onViewModeChange,
	threads,
	resolvedThreads,
	revealInDocument,
	openCommentRail,
	applyRailReveal,
	requestRailOpen,
}: {
	commentParam: string
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	threads: ProjectedCommentThread[]
	resolvedThreads: ProjectedCommentThread[]
	revealInDocument: (rootId: string) => void
	openCommentRail: () => void
	applyRailReveal: CommentDeepLinkModel['applyRailReveal']
	requestRailOpen: CommentDeepLinkModel['requestRailOpen']
}) {
	const navigate = useNavigate()
	const completedRef = useRef(false)
	useMountEffect(() => {
		let firstFrameId: number | null = null
		let secondFrameId: number | null = null
		if (completedRef.current) return
		const consume = () => {
			navigate({
				to: '.',
				replace: true,
				search: (previous: Record<string, unknown>) => ({ ...previous, comment: undefined }),
			})
		}
		const decision = decideCommentDeepLink(commentParam, { threads, resolvedThreads })
		if (decision.status === 'unavailable') {
			completedRef.current = true
			requestRailOpen()
			openCommentRail()
			toast.warning("Couldn't find that comment.", {
				duration: 5000,
				closeButton: true,
			})
			firstFrameId = requestAnimationFrame(() => {
				secondFrameId = requestAnimationFrame(consume)
			})
		} else {
			if (viewMode !== decision.requiredMode) onViewModeChange(decision.requiredMode)
			openCommentRail()
			applyRailReveal({
				rootId: decision.rootId,
				replyId: decision.replyId,
				visibility: decision.visibility,
			})
			if (decision.scrollTarget === 'document') {
				firstFrameId = requestAnimationFrame(() => {
					secondFrameId = requestAnimationFrame(() => {
						if (completedRef.current) return
						completedRef.current = true
						revealInDocument(decision.rootId)
						consume()
					})
				})
			} else {
				completedRef.current = true
				if (decision.threadState === 'outdated') {
					toast.warning("The text this comment was on changed. It's marked Outdated in the comments.", {
						duration: 5000,
						closeButton: true,
					})
				}
				consume()
			}
		}
		return () => {
			if (firstFrameId !== null) cancelAnimationFrame(firstFrameId)
			if (secondFrameId !== null) cancelAnimationFrame(secondFrameId)
		}
	})
	return null
}
