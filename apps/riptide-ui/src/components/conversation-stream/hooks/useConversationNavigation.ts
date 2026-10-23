import type { ConversationEvent, AgentEventGroup } from '@humanlayer/ui/components/conversation-stream'
import type { Virtualizer } from '@tanstack/react-virtual'
import { type MutableRefObject, useCallback, useRef } from 'react'

import type { HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { recordSendScrollDiagnostic } from '@/lib/send-scroll-diagnostics'

import type { VisibleNavigationItem } from '../WiredConversationStream'

interface NavigableItem {
	id: string
	type: 'event' | 'agentgroup' | 'subevent' | 'workblock' | 'compacted'
	toolId?: string
	parentToolId?: string
	parentBlockId?: string
	parentCompactionId?: string
}

export interface UseConversationNavigationControllerProps {
	events: ConversationEvent[]
	/** The same filtered top-level events array that the virtualizer renders. Used for index lookup
	 * on shift+g / gg / minimap-driven scroll. Comes from useSessionEvents so the index aligns with
	 * the rendered rows. */
	rootEvents: ConversationEvent[]
	agentGroups: Map<string, AgentEventGroup>
	/** Reads the expanded-agent set at call time. Production passes
	 * `readExpandedAgentsFromStore`; demos with local expansion state pass
	 * their own reader. A plain Set prop would force the caller (the session
	 * detail provider) to subscribe and re-render the whole page on every
	 * expand/collapse. */
	getExpandedAgents: () => Set<string>
	onToggleAgentGroup: (taskId: string) => void
	onRequestModal?: (event: ConversationEvent, result?: ConversationEvent) => void
	onOpenFile?: (filePath: string) => void
	toolResultsByKey: Record<string, ConversationEvent>
	/** Called when keyboard navigation starts, to suppress mouse events during scroll */
	startKeyboardNavigation?: () => void
	/** Ref to the virtualizer instance for scroll-to-index */
	virtualizerRef?: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>
	/** Ref to visible event id -> virtual row index for index lookup */
	visibleEventIndexRef?: MutableRefObject<Map<string, number>>
	/** Ref to visible virtualized items for keyboard navigation */
	visibleItemsRef?: MutableRefObject<VisibleNavigationItem[]>
}

export interface UseConversationNavigationHotkeysProps {
	controller: ConversationNavigationController
	scopes: HotkeyScope[]
	disabled?: boolean
}

type UseConversationNavigationProps = UseConversationNavigationControllerProps &
	Omit<UseConversationNavigationHotkeysProps, 'controller'>

export const readExpandedAgentsFromStore = () => useExpansionStore.getState().expandedAgents

/** Owns navigation commands and scrolling, without registering keyboard bindings. */
export function useConversationNavigationController({
	events,
	rootEvents,
	agentGroups,
	getExpandedAgents,
	onToggleAgentGroup,
	onRequestModal,
	onOpenFile,
	toolResultsByKey,
	startKeyboardNavigation,
	virtualizerRef,
	visibleEventIndexRef,
	visibleItemsRef,
}: UseConversationNavigationControllerProps) {
	// Focus lives in the focus store. Deliberately NOT subscribed here: every
	// handler below runs on a keypress and reads the current value via
	// getState(), and the scroll-into-view listener subscribes directly. A
	// selector subscription would re-render this hook's owner (the session
	// detail provider — i.e. the whole page) on every j/k.
	const setFocusedEventId = useFocusStore((s) => s.setFocusedEventId)
	const clearFocus = useFocusStore((s) => s.clearFocus)

	// scrollBlock is only read by the scroll listener - a ref avoids re-renders
	const scrollBlockRef = useRef<'nearest' | 'start'>('nearest')

	// Mirror rootEvents into a ref so the keyboard-scroll effect can read the latest
	// array for index lookup without listing rootEvents as a dependency. Depending on
	// rootEvents would re-run that effect on every streamed event and re-scroll to the
	// focused row even while the user has scrolled away to read earlier output (CORE-1258).
	const rootEventsRef = useRef(rootEvents)
	rootEventsRef.current = rootEvents

	// Helper to focus an event with keyboard navigation and optional scroll behavior
	const focusEvent = useCallback(
		(id: string, block: 'nearest' | 'start' = 'nearest') => {
			startKeyboardNavigation?.()
			scrollBlockRef.current = block
			setFocusedEventId(id, 'keyboard')
		},
		[startKeyboardNavigation, setFocusedEventId],
	)

	// Build flat list of navigable items. Called inside the handlers, NOT at
	// render time: focus changes no longer re-render this hook's owner, so a
	// render-time snapshot would go stale the moment the stream regroups rows
	// (e.g. a run collapsing into a working block) and j/k would walk the old
	// list. visibleItemsRef always holds the rows the virtualizer just rendered.
	const buildNavigableItems = useCallback((): NavigableItem[] => {
		if (visibleItemsRef?.current.length) {
			return visibleItemsRef.current
		}

		const expandedAgents = getExpandedAgents()
		const navigableRootEvents = events.filter((e) => !e.parentToolUseId && e.eventType !== 'tool_result')

		const expandedSubItems = (agentGroup: AgentEventGroup, parentToolId: string | undefined): NavigableItem[] =>
			agentGroup.subAgentEvents
				.filter((subEvent) => subEvent.eventType !== 'tool_result')
				.map((subEvent) => ({ id: subEvent.id, type: 'subevent', parentToolId }))

		return navigableRootEvents.flatMap((event): NavigableItem[] => {
			const toolId = event.toolId
			const agentGroup = toolId ? agentGroups.get(toolId) : undefined

			if (!agentGroup || !toolId) {
				return [{ id: event.id, type: 'event' }]
			}

			const agentGroupItem: NavigableItem = { id: event.id, type: 'agentgroup', toolId }
			const isExpanded = expandedAgents.has(toolId)

			return isExpanded ? [agentGroupItem, ...expandedSubItems(agentGroup, toolId)] : [agentGroupItem]
		})
	}, [events, agentGroups, getExpandedAgents, visibleItemsRef])

	// J - next
	const focusNext = useCallback(() => {
		const navigableItems = buildNavigableItems()
		if (navigableItems.length === 0) return

		startKeyboardNavigation?.()
		const focusedEventId = useFocusStore.getState().focusedEventId
		const currentIndex =
			focusedEventId !== null ? navigableItems.findIndex((item) => item.id === focusedEventId) : -1

		let targetIndex: number
		if (currentIndex === -1) {
			targetIndex = 0
		} else if (currentIndex < navigableItems.length - 1) {
			targetIndex = currentIndex + 1
		} else {
			// At last item - stay in place (no wrap-around)
			targetIndex = currentIndex
		}

		const nextItem = navigableItems[targetIndex]
		if (nextItem === undefined) return
		scrollBlockRef.current = 'nearest'
		setFocusedEventId(nextItem.id, 'keyboard')
	}, [buildNavigableItems, startKeyboardNavigation, setFocusedEventId])

	// K - previous
	const focusPrevious = useCallback(() => {
		const navigableItems = buildNavigableItems()
		if (navigableItems.length === 0) return

		startKeyboardNavigation?.()
		const focusedEventId = useFocusStore.getState().focusedEventId
		const currentIndex =
			focusedEventId !== null ? navigableItems.findIndex((item) => item.id === focusedEventId) : -1

		let targetIndex: number
		if (currentIndex === -1) {
			targetIndex = navigableItems.length - 1
		} else if (currentIndex > 0) {
			targetIndex = currentIndex - 1
		} else {
			// At first item - stay in place (no wrap-around)
			targetIndex = currentIndex
		}

		const prevItem = navigableItems[targetIndex]
		if (prevItem === undefined) return
		scrollBlockRef.current = 'nearest'
		setFocusedEventId(prevItem.id, 'keyboard')
	}, [buildNavigableItems, startKeyboardNavigation, setFocusedEventId])

	// H - collapse/go to parent, or toggle the focused agent group / working block
	const collapse = useCallback(() => {
		const focusedEventId = useFocusStore.getState().focusedEventId
		if (!focusedEventId) return

		const currentItem = buildNavigableItems().find((item) => item.id === focusedEventId)
		if (!currentItem) return

		startKeyboardNavigation?.()
		if (currentItem.type === 'workblock') {
			if (
				currentItem.parentCompactionId &&
				!useExpansionStore.getState().expandedWorkBlocks.has(currentItem.id)
			) {
				useExpansionStore.getState().collapseCompaction(currentItem.parentCompactionId)
				setFocusedEventId(currentItem.parentCompactionId, 'keyboard')
				return
			}
			useExpansionStore.getState().collapseWorkBlock(currentItem.id)
			return
		}
		if (currentItem.type === 'compacted') {
			useExpansionStore.getState().collapseCompaction(currentItem.id)
			return
		}
		if (currentItem.type === 'subevent') {
			// Find parent agent group
			const event = events.find((e) => e.id === focusedEventId)
			const parentToolId = currentItem.parentToolId ?? event?.parentToolUseId
			if (parentToolId) {
				const group = agentGroups.get(parentToolId)
				if (!group?.hasPendingApproval) {
					onToggleAgentGroup(parentToolId)
				}
				// Focus parent
				const parentEvent = events.find((e) => e.toolId === parentToolId)
				if (parentEvent) setFocusedEventId(parentEvent.id, 'keyboard')
			}
		} else if (currentItem.type === 'agentgroup' && currentItem.toolId) {
			const group = agentGroups.get(currentItem.toolId)
			const isExpanded = getExpandedAgents().has(currentItem.toolId)
			if (!isExpanded && currentItem.parentBlockId) {
				// Collapsed agent group inside an expanded working block: h closes the block.
				useExpansionStore.getState().collapseWorkBlock(currentItem.parentBlockId)
				setFocusedEventId(currentItem.parentBlockId, 'keyboard')
			} else if (!isExpanded && currentItem.parentCompactionId) {
				useExpansionStore.getState().collapseCompaction(currentItem.parentCompactionId)
				setFocusedEventId(currentItem.parentCompactionId, 'keyboard')
			} else if (!(isExpanded && group?.hasPendingApproval)) {
				onToggleAgentGroup(currentItem.toolId)
			}
		} else if (currentItem.parentBlockId) {
			// Plain event inside an expanded working block: h closes the block.
			useExpansionStore.getState().collapseWorkBlock(currentItem.parentBlockId)
			setFocusedEventId(currentItem.parentBlockId, 'keyboard')
		} else if (currentItem.parentCompactionId) {
			// Row revealed inside the compacted history: h folds the history again.
			useExpansionStore.getState().collapseCompaction(currentItem.parentCompactionId)
			setFocusedEventId(currentItem.parentCompactionId, 'keyboard')
		}
	}, [
		buildNavigableItems,
		events,
		agentGroups,
		getExpandedAgents,
		onToggleAgentGroup,
		startKeyboardNavigation,
		setFocusedEventId,
	])

	// L - expand
	const expand = useCallback(() => {
		const focusedEventId = useFocusStore.getState().focusedEventId
		if (!focusedEventId) return

		const currentItem = buildNavigableItems().find((item) => item.id === focusedEventId)
		if (!currentItem) return

		startKeyboardNavigation?.()
		if (currentItem.type === 'workblock') {
			useExpansionStore.getState().expandWorkBlock(currentItem.id)
			return
		}
		if (currentItem.type === 'compacted') {
			useExpansionStore.getState().expandCompaction(currentItem.id)
			return
		}
		if (currentItem.type === 'agentgroup' && currentItem.toolId) {
			if (!getExpandedAgents().has(currentItem.toolId)) {
				onToggleAgentGroup(currentItem.toolId)
			}
		}
	}, [buildNavigableItems, getExpandedAgents, onToggleAgentGroup, startKeyboardNavigation])

	// I - inspect/expand modal
	const inspect = useCallback(() => {
		const focusedEventId = useFocusStore.getState().focusedEventId
		if (!focusedEventId || !onRequestModal) return

		const event = events.find((e) => e.id === focusedEventId)
		if (!event || event.eventType !== 'tool_call') return

		const toolResult = event.toolId ? toolResultsByKey[event.toolId] : undefined
		onRequestModal(event, toolResult)
	}, [events, toolResultsByKey, onRequestModal])

	// U - jump to most recent user message (skips sub-agent user messages)
	const jumpToUser = useCallback(() => {
		startKeyboardNavigation?.()
		// Find the most recent root-level user message (search from end, skip sub-agent messages)
		for (let i = events.length - 1; i >= 0; i--) {
			const event = events[i]
			if (event === undefined) continue
			if (event.eventType === 'message' && event.role === 'user' && !event.parentToolUseId) {
				scrollBlockRef.current = 'start'
				setFocusedEventId(event.id, 'keyboard')
				break
			}
		}
	}, [events, startKeyboardNavigation, setFocusedEventId])

	// O - open file
	const openFile = useCallback(() => {
		const focusedEventId = useFocusStore.getState().focusedEventId
		if (!focusedEventId || !onOpenFile) return

		const event = events.find((e) => e.id === focusedEventId)
		if (!event || event.eventType !== 'tool_call') return

		const fileTools = ['Read', 'Write', 'Edit', 'MultiEdit']
		if (!fileTools.includes(event.toolName || '')) return

		try {
			const input = JSON.parse(event.toolInputJson || '{}')
			if (input.file_path) {
				onOpenFile(input.file_path)
			}
		} catch {
			// Ignore
		}
	}, [events, onOpenFile])

	// Shift+G - jump to bottom of the last visible row
	//
	// The first scrollToIndex uses the virtualizer's estimateSize (100px) for any unrendered
	// row. Real rows are typically much taller, so a single call lands above the actual bottom.
	// After the row paints, measureElement reports the real height — but the virtualizer does
	// not auto-correct scrollTop. We re-issue the scroll on the next two frames to settle on
	// the post-measure offset.
	//
	// Each rAF retry re-reads visibleItemsRef.current.length so (a) we always target the actual
	// last virtualizer row — including expanded sub-agent rows, since the virtualizer's count is
	// virtualItems.length, not rootEvents.length — and (b) streaming events that arrive between
	// frames extend the target index instead of leaving us parked on a now-interior row
	// (CORE-1179 root cause).
	//
	// The trailing retries are aborted if the user manually scrolls (wheel/touch) before they
	// fire. Without this, streaming sub-agent output drives sticky-bottom auto-scroll to call
	// jumpToBottom continuously, and the unconditional retries keep re-pinning the viewport —
	// the user cannot scroll away to read earlier messages until the task completes (CORE-1258).
	const jumpToBottom = useCallback(() => {
		let attempt = 0
		const scrollOnce = () => {
			attempt += 1
			const virtualizer = virtualizerRef?.current
			const items = visibleItemsRef?.current
			if (!virtualizer || !items || items.length === 0) return
			recordSendScrollDiagnostic('jump_to_bottom_before_scroll', {
				attempt,
				targetIndex: items.length - 1,
				itemCount: items.length,
				virtualTotalSize: virtualizer.getTotalSize(),
			})
			virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
			recordSendScrollDiagnostic('jump_to_bottom_after_scroll', {
				attempt,
				targetIndex: items.length - 1,
				itemCount: items.length,
				virtualTotalSize: virtualizer.getTotalSize(),
			})
		}
		const items = visibleItemsRef?.current
		if (!items || items.length === 0) return
		const lastItem = items[items.length - 1]
		if (lastItem === undefined) return
		scrollOnce()
		setFocusedEventId(lastItem.id, 'keyboard')
		recordSendScrollDiagnostic('conversation_keyboard_focus_requested', { itemCount: items.length })

		const scrollEl = virtualizerRef?.current?.scrollElement
		let raf1: number | null = null
		let raf2: number | null = null
		const cancelRetries = (event?: Event) => {
			recordSendScrollDiagnostic('jump_to_bottom_retries_finished', {
				reason: event?.type ?? 'completed',
			})
			if (raf1 !== null) cancelAnimationFrame(raf1)
			if (raf2 !== null) cancelAnimationFrame(raf2)
			raf1 = null
			raf2 = null
			scrollEl?.removeEventListener('wheel', cancelRetries)
			scrollEl?.removeEventListener('touchmove', cancelRetries)
		}
		scrollEl?.addEventListener('wheel', cancelRetries, { passive: true })
		scrollEl?.addEventListener('touchmove', cancelRetries, { passive: true })
		raf1 = requestAnimationFrame(() => {
			scrollOnce()
			raf2 = requestAnimationFrame(() => {
				scrollOnce()
				cancelRetries()
			})
		})
	}, [virtualizerRef, visibleItemsRef, setFocusedEventId])

	// gg - jump to top (true DOM top, precondition-free)
	const jumpToTop = useCallback(() => {
		const virtualizer = virtualizerRef?.current
		if (!virtualizer) return
		virtualizer.scrollToIndex(0, { align: 'start' })
		if (rootEvents.length > 0) {
			const firstEvent = rootEvents[0]
			if (firstEvent !== undefined) {
				setFocusedEventId(firstEvent.id, 'keyboard')
			}
		}
	}, [virtualizerRef, rootEvents, setFocusedEventId])

	// Scroll into view on keyboard navigation.
	//
	// A store subscription, not a render effect: it fires only when focus is
	// actually set (never on streamed events — re-scrolling on data changes
	// would yank the viewport back while the user reads earlier output during
	// a running session, CORE-1258), and it keeps this hook free of focus
	// subscriptions so its owner does not re-render per keypress. Mount-scoped:
	// every value it reads is a stable ref.
	useMountEffect(() =>
		useFocusStore.subscribe((state, prevState) => {
			// Unrelated store writes (e.g. isEditorFocused) must not re-scroll.
			if (state.focusedEventId === prevState.focusedEventId && state.focusSource === prevState.focusSource) return
			if (state.focusedEventId === null || state.focusSource !== 'keyboard') return
			const virtualizer = virtualizerRef?.current
			if (!virtualizer) return
			const index =
				visibleEventIndexRef?.current.get(state.focusedEventId) ??
				rootEventsRef.current.findIndex((e) => e.id === state.focusedEventId)
			if (index < 0) return
			const align = scrollBlockRef.current === 'start' ? 'start' : 'auto'
			recordSendScrollDiagnostic('keyboard_focus_scroll_before', {
				index,
				align,
				virtualTotalSize: virtualizer.getTotalSize(),
			})
			virtualizer.scrollToIndex(index, { align })
			recordSendScrollDiagnostic('keyboard_focus_scroll_after', {
				index,
				align,
				virtualTotalSize: virtualizer.getTotalSize(),
			})
		}),
	)

	return {
		focusNext,
		focusPrevious,
		collapse,
		expand,
		inspect,
		jumpToUser,
		openFile,
		setFocusedEventId,
		focusEvent,
		jumpToBottom,
		jumpToTop,
		handleFocusChange: useCallback(
			(id: string | null, source: 'mouse' | 'keyboard') => {
				if (id === null) {
					clearFocus()
				} else {
					setFocusedEventId(id, source)
				}
			},
			[setFocusedEventId, clearFocus],
		),
	}
}

export type ConversationNavigationController = ReturnType<typeof useConversationNavigationController>

/** Binds one existing controller; does not own navigation state or scroll subscriptions. */
export function useConversationNavigationHotkeys({
	controller,
	scopes,
	disabled = false,
}: UseConversationNavigationHotkeysProps) {
	const { focusNext, focusPrevious, collapse, expand, inspect, jumpToUser, openFile, jumpToBottom, jumpToTop } =
		controller

	useAppHotkeys(
		'j, ArrowDown',
		(e) => {
			e.preventDefault()
			focusNext()
		},
		{ enabled: !disabled, scopes, area: 'MAIN' },
		[focusNext, disabled],
	)
	useAppHotkeys(
		'k, ArrowUp',
		(e) => {
			e.preventDefault()
			focusPrevious()
		},
		{ enabled: !disabled, scopes, area: 'MAIN' },
		[focusPrevious, disabled],
	)
	useAppHotkeys('h', collapse, { enabled: !disabled, scopes, area: 'MAIN' }, [collapse, disabled])
	useAppHotkeys('l', expand, { enabled: !disabled, scopes, area: 'MAIN' }, [expand, disabled])
	useAppHotkeys('i', inspect, { enabled: !disabled, scopes, area: 'MAIN' }, [inspect, disabled])
	useAppHotkeys('u', jumpToUser, { enabled: !disabled, scopes, area: 'MAIN' }, [jumpToUser, disabled])
	useAppHotkeys('o', openFile, { enabled: !disabled, scopes, area: 'MAIN' }, [openFile, disabled])
	useAppHotkeys('shift+g', jumpToBottom, { enabled: !disabled, scopes, area: 'MAIN' }, [jumpToBottom, disabled])
	useAppHotkeys('g>g', jumpToTop, { preventDefault: true, enabled: !disabled, scopes, area: 'MAIN' }, [
		jumpToTop,
		disabled,
	])
}

/** Compatibility composition for callers that own both commands and bindings (including ShellDemo). */
export function useConversationNavigation({ scopes, disabled, ...props }: UseConversationNavigationProps) {
	const controller = useConversationNavigationController(props)
	useConversationNavigationHotkeys({ controller, scopes, disabled })
	return controller
}
