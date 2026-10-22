import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { Bot, User, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export interface ForkableMessage {
	id: string
	role: 'user' | 'assistant'
	content: string | null
	createdAt: Date
}

export interface ForkSelectorPanelProps {
	events: ForkableMessage[]
	selectedEventId: string | null
	onSelectEvent: (eventId: string) => void
	onCancel: () => void
	/** ID of the first user message — cannot be forked from */
	firstUserMessageId: string | null
	/** Called when Enter is pressed on a selected message — used to focus the prompt box */
	onConfirmSelection: () => void
}

export function ForkSelectorPanel({
	events,
	selectedEventId,
	onSelectEvent,
	onCancel,
	firstUserMessageId,
	onConfirmSelection,
}: ForkSelectorPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null)

	// Auto-scroll selected message into view
	useEffect(() => {
		if (!selectedEventId || !scrollContainerRef.current) return
		const el = scrollContainerRef.current.querySelector(`[data-fork-event-id="${selectedEventId}"]`)
		el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
	}, [selectedEventId])

	const truncate = (text: string | null, maxLen = 80) => {
		if (!text) return '(empty message)'
		return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
	}

	// Get indices of only user messages for keyboard navigation (excluding the first user message)
	const userEventIndices = useMemo(
		() => events.filter((e) => e.role === 'user' && e.id !== firstUserMessageId).map((event) => ({ event })),
		[events, firstUserMessageId],
	)

	const selectedUserIndex = useMemo(
		() => userEventIndices.findIndex(({ event }) => event.id === selectedEventId),
		[userEventIndices, selectedEventId],
	)

	// j / ArrowDown — select next user message
	useHotkeys(
		'j,down',
		(e) => {
			e.preventDefault()
			if (userEventIndices.length === 0) return
			const nextIndex = selectedUserIndex >= userEventIndices.length - 1 ? 0 : selectedUserIndex + 1
			const nextEntry = userEventIndices[nextIndex]
			if (nextEntry === undefined) return
			onSelectEvent(nextEntry.event.id)
		},
		{ scopes: [HOTKEY_SCOPES.FORK_SELECTOR] },
		[userEventIndices, selectedUserIndex, onSelectEvent],
	)

	// k / ArrowUp — select previous user message
	useHotkeys(
		'k,up',
		(e) => {
			e.preventDefault()
			if (userEventIndices.length === 0) return
			const prevIndex = selectedUserIndex <= 0 ? userEventIndices.length - 1 : selectedUserIndex - 1
			const prevEntry = userEventIndices[prevIndex]
			if (prevEntry === undefined) return
			onSelectEvent(prevEntry.event.id)
		},
		{ scopes: [HOTKEY_SCOPES.FORK_SELECTOR] },
		[userEventIndices, selectedUserIndex, onSelectEvent],
	)

	// escape — cancel fork (enableOnFormTags so it works from the textarea)
	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			onCancel()
		},
		{ scopes: [HOTKEY_SCOPES.FORK_SELECTOR], enableOnFormTags: true },
		[onCancel],
	)

	// Enter — confirm selection and focus the prompt box
	useHotkeys(
		'enter',
		(e) => {
			e.preventDefault()
			if (selectedEventId) {
				onConfirmSelection()
			}
		},
		{ scopes: [HOTKEY_SCOPES.FORK_SELECTOR] },
		[selectedEventId, onConfirmSelection],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.FORK_SELECTOR}
			isActive={true}
			rootScopeDisabled={true}
			componentName="ForkSelectorPanel"
		>
			<div className="flex flex-col h-full min-h-0 border border-border">
				{/* Header */}
				<div className="flex items-center justify-between p-2 border-b border-border/50">
					<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Select user message to fork from
					</span>
					<Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onCancel}>
						<X className="h-3 w-3" />
					</Button>
				</div>

				{/* Message list */}
				<div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto p-2">
					{events.map((event) => {
						const isUser = event.role === 'user'
						const isFirstUser = event.id === firstUserMessageId
						const isSelectable = isUser && !isFirstUser
						const isSelected = event.id === selectedEventId
						return (
							<div
								key={event.id}
								data-fork-event-id={event.id}
								className={cn(
									'px-2 py-1.5 rounded-sm text-xs cursor-default transition-colors border-l-2',
									isSelectable ? 'border-l-[var(--terminal-accent)]' : 'border-l-muted-foreground/20',
									isSelectable && 'cursor-pointer hover:bg-accent/10',
									isSelectable && isSelected && 'bg-accent/20 ring-1 ring-inset ring-accent',
									!isSelectable && 'opacity-50 pointer-events-none',
								)}
								onClick={
									isSelectable
										? () => {
												onSelectEvent(event.id)
											}
										: undefined
								}
							>
								<div className="flex items-center gap-1.5">
									{isUser ? (
										<User className="h-3 w-3 shrink-0 text-muted-foreground" />
									) : (
										<Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
									)}
									<span className="truncate flex-1">{truncate(event.content)}</span>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</HotkeyScopeBoundary>
	)
}
