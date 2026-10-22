import { Card, CardContent } from '@humanlayer/ui/components/card'
import {
	buildAgentGroups,
	type ConversationEvent,
	createToolResultsByKey,
	type AgentEventGroup,
} from '@humanlayer/ui/components/conversation-stream'
import { VerticalMinimap } from '@humanlayer/ui/components/vertical-minimap'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { eventsToMinimapEvents } from '@/utils/sidebar-transforms'

import { AgentGroupEventRow } from './AgentGroupEventRow'
import { ConversationEventRow } from './ConversationEventRow'
import { generateStressConversation, type StressScenario } from './mock-data'

type HarnessVariant = 'virtualized' | 'virtualized-sidebar' | 'virtualized-no-measure'

type VirtualStreamItem =
	| { type: 'root'; event: ConversationEvent; group: AgentEventGroup }
	| { type: 'event'; event: ConversationEvent; parentToolId?: string }

export interface ConversationStreamStressHarnessProps {
	scenario?: StressScenario
	variant?: HarnessVariant
	eventCount?: number
	largeContentBytes?: number
	subAgentEventCount?: number
	initiallyExpandGroups?: boolean
	overscan?: number
}

declare global {
	interface Window {
		__riptidePerf?: Record<string, unknown>
	}
}

export function ConversationStreamStressHarness({
	scenario = 'flat',
	variant = 'virtualized-sidebar',
	eventCount = 1000,
	largeContentBytes = 25_000,
	subAgentEventCount,
	initiallyExpandGroups = false,
	overscan = 20,
}: ConversationStreamStressHarnessProps) {
	const parentRef = useRef<HTMLDivElement>(null)
	const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
	const [heartbeatMaxDriftMs, setHeartbeatMaxDriftMs] = useState(0)
	const [nodeCount, setNodeCount] = useState(0)

	const generated = useMemo(
		() => generateStressConversation({ scenario, eventCount, largeContentBytes, subAgentEventCount }),
		[scenario, eventCount, largeContentBytes, subAgentEventCount],
	)

	const events = generated.events
	const toolResultsByKey = useMemo(() => createToolResultsByKey(events), [events])
	const grouping = useMemo(() => buildAgentGroups(events, toolResultsByKey), [events, toolResultsByKey])
	const agentGroups = grouping.agentGroups
	const rootEvents = grouping.rootEvents
	const expandedAgents = useExpansionStore((s) => s.expandedAgents)
	const expandAgent = useExpansionStore((s) => s.expand)
	const clearExpansion = useExpansionStore((s) => s.clear)
	const virtualItems = useMemo(() => {
		const items: VirtualStreamItem[] = []
		for (const event of rootEvents) {
			const agentGroup = event.toolId ? agentGroups.get(event.toolId) : undefined
			if (agentGroup) {
				items.push({ type: 'root', event, group: agentGroup })
				if (event.toolId && expandedAgents.has(event.toolId)) {
					for (const subEvent of agentGroup.subAgentEvents) {
						if (subEvent.eventType !== 'tool_result')
							items.push({ type: 'event', event: subEvent, parentToolId: event.toolId })
					}
				}
				continue
			}
			items.push({ type: 'event', event })
		}
		return items
	}, [rootEvents, agentGroups, expandedAgents])
	const minimapEvents = useMemo(() => eventsToMinimapEvents(events), [events])

	useEffect(() => {
		clearExpansion()
		if (initiallyExpandGroups) {
			for (const taskId of agentGroups.keys()) expandAgent(taskId)
		}
		return () => clearExpansion()
	}, [agentGroups, initiallyExpandGroups, expandAgent, clearExpansion])

	const virtualizer = useVirtualizer({
		count: virtualItems.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 100,
		getItemKey: (index) => virtualItems[index]?.event.id ?? index,
		overscan,
	})

	useMountEffect(() => {
		let last = performance.now()
		let cancelled = false
		const tick = () => {
			const now = performance.now()
			setHeartbeatMaxDriftMs((prev) => Math.max(prev, Math.max(0, now - last - 100)))
			last = now
			if (!cancelled) setTimeout(tick, 100)
		}
		const timeout = setTimeout(tick, 100)
		return () => {
			cancelled = true
			clearTimeout(timeout)
		}
	})

	useMountEffect(() => {
		const update = () => setNodeCount(document.querySelectorAll('*').length)
		update()
		const id = window.setInterval(update, 1000)
		return () => window.clearInterval(id)
	})

	useEffect(() => {
		window.__riptidePerf = {
			scenario,
			variant,
			eventCount: events.length,
			rootEventCount: rootEvents.length,
			agentGroupCount: agentGroups.size,
			heartbeatMaxDriftMs,
			nodeCount,
			virtualItemCount: virtualItems.length,
			renderedVirtualItems: virtualizer.getVirtualItems().length,
		}
	}, [
		scenario,
		variant,
		events.length,
		rootEvents.length,
		agentGroups.size,
		heartbeatMaxDriftMs,
		nodeCount,
		virtualizer,
		virtualItems.length,
	])

	const handleMinimapClick = useCallback(
		(eventId: string) => {
			setFocusedEventId(eventId)
			const index = virtualItems.findIndex((item) => item.event.id === eventId)
			if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
		},
		[virtualItems, virtualizer],
	)

	return (
		<div className="h-screen flex flex-col bg-background text-foreground" data-riptide-stress-harness>
			<div className="shrink-0 flex items-center gap-3 border-b px-3 py-2 text-xs font-mono">
				<span>scenario: {scenario}</span>
				<span>variant: {variant}</span>
				<span>events: {events.length}</span>
				<span>root: {rootEvents.length}</span>
				<span>virtual: {virtualItems.length}</span>
				<span>groups: {agentGroups.size}</span>
				<span>nodes: {nodeCount}</span>
				<span>max drift: {heartbeatMaxDriftMs.toFixed(0)}ms</span>
			</div>

			<div
				className="grid flex-1 min-h-0"
				style={{ gridTemplateColumns: variant === 'virtualized-sidebar' ? '1fr 320px' : '1fr' }}
			>
				<Card className="m-3 min-h-0 overflow-hidden">
					<CardContent className="h-full p-0">
						<div ref={parentRef} className="h-full overflow-y-auto" data-conversation-container>
							<div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
								{virtualizer.getVirtualItems().map((virtualRow) => {
									const item = virtualItems[virtualRow.index]
									if (!item) return null
									const event = item.event
									const agentGroup: AgentEventGroup | null = item.type === 'root' ? item.group : null
									const toolResult = event.toolId ? toolResultsByKey[event.toolId] : undefined

									return (
										<div
											key={virtualRow.key}
											data-index={virtualRow.index}
											ref={
												variant === 'virtualized-no-measure'
													? undefined
													: virtualizer.measureElement
											}
											style={{
												position: 'absolute',
												top: 0,
												left: 0,
												width: '100%',
												transform: `translateY(${virtualRow.start}px)`,
											}}
										>
											{agentGroup ? (
												<AgentGroupEventRow
													group={agentGroup}
													isExpanded={
														!!agentGroup.parentAgent.toolId &&
														expandedAgents.has(agentGroup.parentAgent.toolId)
													}
													onToggle={() => {
														if (agentGroup.parentAgent.toolId) {
															useExpansionStore
																.getState()
																.toggle(agentGroup.parentAgent.toolId)
														}
													}}
													toolResultsByKey={toolResultsByKey}
													workingDir="/Users/dev/project"
													isFocused={focusedEventId === agentGroup.parentAgent.id}
													focusedEventId={focusedEventId}
													onFocusChange={(id) => setFocusedEventId(id)}
													shouldIgnoreMouseEvent={() => false}
													approvingApprovalId={null}
													denyingApprovalId={null}
													isInterrupted={false}
													isSessionActive={false}
													isCurrentTurn={true}
													onCopy={() => {}}
													renderChildren={false}
												/>
											) : (
												<ConversationEventRow
													event={event}
													toolResult={toolResult}
													isGroupItem={item.type === 'event' && !!item.parentToolId}
													workingDir="/Users/dev/project"
													isFocused={focusedEventId === event.id}
													onFocusChange={(id) => setFocusedEventId(id)}
													shouldIgnoreMouseEvent={() => false}
													onCopy={() => {}}
												/>
											)}
										</div>
									)
								})}
							</div>
						</div>
					</CardContent>
				</Card>

				{variant === 'virtualized-sidebar' && (
					<Card className="m-3 ml-0 min-h-0 overflow-hidden">
						<CardContent className="h-full p-2">
							<VerticalMinimap
								events={minimapEvents}
								focusedEventId={focusedEventId}
								onEventClick={handleMinimapClick}
								maxEventIndex={events.length - 1}
							/>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	)
}
