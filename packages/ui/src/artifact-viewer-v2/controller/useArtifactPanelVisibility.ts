import { useCallback, useReducer, useRef } from 'react'

import type { ArtifactTracePort } from '../trace/artifact-side-panel-trace'
import type { ArtifactOutlinePreferencePort, ArtifactOutlinePreference, ArtifactReadingSurface } from './types'

const OUTLINE_DEFAULT_CLOSED_WIDTH_PX = 500
const COMMENT_RAIL_AUTO_COLLAPSE_WIDTH_PX = 480

interface PanelVisibilityState {
	presentation: ArtifactReadingSurface | undefined
	width: number | null
	outlinePreference: ArtifactOutlinePreference
	commentRailOpen: boolean
}

type PanelVisibilityAction =
	| { type: 'measure'; width: number; activeInteraction: boolean }
	| { type: 'presentation'; presentation: ArtifactReadingSurface | undefined; preference?: ArtifactOutlinePreference }
	| { type: 'set-outline-preference'; preference: ArtifactOutlinePreference }
	| { type: 'set-comment-rail'; open: boolean }

function reducePanelVisibility(state: PanelVisibilityState, action: PanelVisibilityAction): PanelVisibilityState {
	switch (action.type) {
		case 'presentation':
			return {
				...state,
				presentation: action.presentation,
				outlinePreference: action.preference ?? state.outlinePreference,
			}
		case 'measure': {
			const wasRailNarrow = state.width !== null && state.width <= COMMENT_RAIL_AUTO_COLLAPSE_WIDTH_PX
			const railNarrow = action.width <= COMMENT_RAIL_AUTO_COLLAPSE_WIDTH_PX
			return {
				...state,
				width: action.width,
				commentRailOpen:
					railNarrow && !wasRailNarrow && !action.activeInteraction ? false : state.commentRailOpen,
			}
		}
		case 'set-outline-preference':
			return { ...state, outlinePreference: action.preference }
		case 'set-comment-rail':
			return { ...state, commentRailOpen: action.open }
	}
}

interface UseArtifactPanelVisibilityOptions {
	presentation?: ArtifactReadingSurface
	activeInteraction?: boolean
	outlinePreference?: ArtifactOutlinePreferencePort
	commentRailDefaultOpen?: boolean
	trace?: ArtifactTracePort
	traceInstanceId?: string
}

interface ArtifactPanelVisibility {
	outlineOpen: boolean
	commentRailOpen: boolean
	viewerContainerRef: (node: HTMLDivElement | null) => void | (() => void)
	focusViewer: () => void
	toggleOutline: () => void
	setCommentRailOpen: (open: boolean) => void
	toggleCommentRail: () => void
}

/** Owns responsive panel defaults and explicit user visibility choices. */
export function useArtifactPanelVisibility({
	presentation,
	activeInteraction = false,
	outlinePreference,
	commentRailDefaultOpen,
	trace,
	traceInstanceId,
}: UseArtifactPanelVisibilityOptions): ArtifactPanelVisibility {
	const [state, dispatch] = useReducer(reducePanelVisibility, {
		presentation,
		width: null,
		outlinePreference: outlinePreference?.preference ?? 'auto',
		commentRailOpen: commentRailDefaultOpen ?? true,
	})
	// Entry preserves the current interaction; return restores the sidebar's
	// persisted choice rather than leaking a fullscreen-only outline toggle.
	if (state.presentation !== presentation) {
		dispatch({
			type: 'presentation',
			presentation,
			preference: presentation === 'sidebar' ? (outlinePreference?.preference ?? 'auto') : undefined,
		})
	}
	const committedInteractionRef = useRef(activeInteraction)
	const runtimeRef = useRef({
		trace,
		traceInstanceId,
		width: null as number | null,
		node: null as HTMLDivElement | null,
		outlinePreference: state.outlinePreference,
	})
	runtimeRef.current.trace = trace
	runtimeRef.current.traceInstanceId = traceInstanceId
	runtimeRef.current.outlinePreference = state.outlinePreference

	const attachViewerContainer = useCallback((node: HTMLDivElement | null) => {
		const runtime = runtimeRef.current
		runtime.trace?.record('viewer-container-ref', {
			instanceId: runtime.traceInstanceId,
			attached: node != null,
		})
		runtime.node = node
		if (!node) return

		node.tabIndex = -1
		runtime.width = null
		const measure = (width: number) => {
			const interactionActive =
				committedInteractionRef.current || node.querySelector('[data-artifact-comment-editing="true"]') != null
			const wasNarrow = runtime.width === null ? null : runtime.width < OUTLINE_DEFAULT_CLOSED_WIDTH_PX
			const narrow = width < OUTLINE_DEFAULT_CLOSED_WIDTH_PX
			const wasRailNarrow = runtime.width === null ? null : runtime.width <= COMMENT_RAIL_AUTO_COLLAPSE_WIDTH_PX
			const railNarrow = width <= COMMENT_RAIL_AUTO_COLLAPSE_WIDTH_PX
			runtime.width = width
			runtime.trace?.record('responsive-width', {
				instanceId: runtime.traceInstanceId,
				width: Math.round(width),
				wasNarrow,
				narrow,
				closedPanels:
					(runtime.outlinePreference === 'auto' && narrow && wasNarrow !== true) ||
					(railNarrow && wasRailNarrow !== true && !interactionActive),
			})
			dispatch({ type: 'measure', width, activeInteraction: interactionActive })
		}

		measure(node.getBoundingClientRect().width)
		if (typeof ResizeObserver === 'undefined') {
			return () => {
				if (runtime.node === node) runtime.node = null
			}
		}
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) measure(entry.contentRect.width)
		})
		observer.observe(node)
		return () => {
			observer.disconnect()
			if (runtime.node === node) runtime.node = null
		}
	}, [])
	const viewerContainerRef = useCallback(
		(node: HTMLDivElement | null) => {
			committedInteractionRef.current = activeInteraction
			return attachViewerContainer(node)
		},
		[activeInteraction, attachViewerContainer],
	)

	const outlineOpen =
		state.outlinePreference === 'open' ||
		(state.outlinePreference === 'auto' && (state.width === null || state.width >= OUTLINE_DEFAULT_CLOSED_WIDTH_PX))
	const toggleOutline = () => {
		const preference: ArtifactOutlinePreference = outlineOpen ? 'closed' : 'open'
		dispatch({ type: 'set-outline-preference', preference })
		outlinePreference?.setPreference(preference)
	}
	const setCommentRailOpen = (open: boolean) => dispatch({ type: 'set-comment-rail', open })

	return {
		outlineOpen,
		// Explicit close and responsive narrowing may never unmount a live draft.
		commentRailOpen: state.commentRailOpen || activeInteraction,
		viewerContainerRef,
		focusViewer: () => runtimeRef.current.node?.focus(),
		toggleOutline,
		setCommentRailOpen,
		toggleCommentRail: () => dispatch({ type: 'set-comment-rail', open: !state.commentRailOpen }),
	}
}
