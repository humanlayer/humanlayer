import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import {
	createToolResultsByKey,
	parseContextCompaction,
	parseContextCompactionSummary,
} from '@humanlayer/ui/components/conversation-stream'
import { useMemo } from 'react'

import type { RunningSubAgent } from '@/components/InterruptConfirmDialog'
import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useAgentGrouping } from '@/hooks/useAgentGrouping'
import type { OrgMember } from '@/hooks/useOrgMembers'
import { getSenderPresentation, hasMultipleResolvedSenders } from '@/lib/sender-presentation'
import { getCurrentTurnEventIds } from '@/utils/current-turn'
import { getNextStepButtonLabel } from '@/utils/next-step-labels'
import { bigintToNumber } from '@/utils/session-transforms'
import { isSyntheticSkillPromptMessage, mapSyntheticSkillPromptsToToolResults } from '@/utils/sidebar-transforms'

/**
 * Minimal row shape for events coming from Electric SQL / TanStack DB useLiveQuery.
 * Only includes fields accessed by the event transform and derived state.
 */
interface EventRow {
	id: string
	session_id: string
	event_type: string
	role: string
	content: string | null
	tool_call_id: string | null
	tool_name: string | null
	tool_input_json: unknown
	tool_result_for_id: string | null
	tool_result_content: string | null
	parent_tool_use_id: string | null
	created_at: bigint | number | string | Date | null
	next_step_suggestion?: unknown
	user_id?: string | null
}

interface ApprovalRow {
	id: string
	tool_use_id: string | null
	status: string
	suggestions: unknown
}

/**
 * Hook that transforms raw Electric SQL event/approval rows into ConversationEvent[]
 * and computes all derived state (agent grouping, pending approvals, next-step indicators,
 * visible event IDs for auto-scroll, running sub-agents for interrupt dialog).
 */
export function useSessionEvents({
	eventsQueryData,
	approvalsQueryData,
	queuedMessageUserIds,
	membersMap,
}: {
	eventsQueryData: EventRow[] | undefined
	approvalsQueryData: ApprovalRow[] | undefined
	queuedMessageUserIds: Array<string | null>
	membersMap: Map<string, OrgMember>
}) {
	const eventSenderIds = (eventsQueryData ?? []).map((event) => event.user_id)
	const allSenderIds = [...eventSenderIds, ...queuedMessageUserIds]
	const showSenderNames = hasMultipleResolvedSenders(allSenderIds, membersMap)
	// Shared stream-to-saved membership comes from every raw row, before system,
	// synthetic-prompt or collapsed-group filtering. Never substitute visible IDs.
	const savedEventIds = useMemo<ReadonlySet<string>>(
		() => new Set((eventsQueryData ?? []).map((event) => event.id)),
		[eventsQueryData],
	)
	// Build approval lookup for client-side merge
	const approvalsByToolUseId = useMemo(() => {
		const map = new Map<string, { id: string; status: string; suggestions: unknown }>()
		for (const a of approvalsQueryData ?? []) {
			if (a.tool_use_id) {
				map.set(a.tool_use_id, { id: a.id, status: a.status, suggestions: a.suggestions })
			}
		}
		return map
	}, [approvalsQueryData])

	// Build a Set of tool_call IDs that have results (from raw DB data)
	// This is used to derive isCompleted for tool_call events
	const completedToolIds = useMemo(() => {
		const ids = new Set<string>()
		for (const e of eventsQueryData ?? []) {
			if (e.event_type === 'tool_result' && e.tool_result_for_id) {
				ids.add(e.tool_result_for_id)
			}
		}
		return ids
	}, [eventsQueryData])

	// Compaction summaries ride along their boundary row instead of taking a row
	// of their own: the boundary renders them on demand.
	const compactionSummaries = useMemo<ReadonlyMap<string, string>>(() => {
		const summaries = new Map<string, string>()
		for (const e of eventsQueryData ?? []) {
			if (e.event_type !== 'system') continue
			const summary = parseContextCompactionSummary({ eventType: 'system', content: e.content ?? undefined })
			if (summary) summaries.set(summary.boundaryEventId, summary.summary)
		}
		return summaries
	}, [eventsQueryData])

	// Transform events to ConversationEvent[] with proper typing
	// Use database UUID for event IDs to match WiredConversationStream's DOM elements
	// Sort by created_at to ensure correct chronological order (important for forked sessions
	// where copied history events have original timestamps and the new prompt has a current one).
	// System events (e.g. the initial system prompt) are dropped here rather than in the live
	// query where a not() conjunct would defeat index optimization. Context-compaction
	// boundaries are the exception: they render as a divider in the stream.
	const events: ConversationEvent[] = useMemo(() => {
		const visibleEventRows = (eventsQueryData ?? [])
			.filter(
				(e) =>
					e.event_type !== 'system' ||
					parseContextCompaction({ eventType: 'system', content: e.content ?? undefined }) !== null,
			)
			.sort((a, b) => {
				const aTime = bigintToNumber(a.created_at) ?? 0
				const bTime = bigintToNumber(b.created_at) ?? 0
				return aTime - bTime
			})
		return visibleEventRows.map((e) => {
			const senderMember = e.user_id ? membersMap.get(e.user_id) : undefined
			const sender = getSenderPresentation(senderMember)
			return {
				id: e.id, // Use database UUID for consistent IDs across navigation and rendering
				sessionId: e.session_id,
				eventType: e.event_type as ConversationEvent['eventType'],
				role: e.role as ConversationEvent['role'],
				content: e.content ?? undefined,
				sender,
				toolId: e.tool_call_id ?? undefined,
				toolName: e.tool_name ?? undefined,
				// tool_input_json may come as object (jsonb parsed) or string (already serialized)
				toolInputJson: e.tool_input_json
					? typeof e.tool_input_json === 'string'
						? e.tool_input_json
						: JSON.stringify(e.tool_input_json)
					: undefined,
				toolResultForId: e.tool_result_for_id ?? undefined,
				toolResultContent: e.tool_result_content ?? undefined,
				parentToolUseId: e.parent_tool_use_id ?? undefined,
				// Derive isCompleted: true if this tool_call has a corresponding tool_result
				isCompleted:
					e.event_type === 'tool_call' && e.tool_call_id ? completedToolIds.has(e.tool_call_id) : undefined,
				approvalId: approvalsByToolUseId.get(e.tool_call_id ?? '')?.id ?? undefined,
				approvalStatus:
					(approvalsByToolUseId.get(e.tool_call_id ?? '')?.status as ConversationEvent['approvalStatus']) ??
					undefined,
				suggestions: approvalsByToolUseId.get(e.tool_call_id ?? '')?.suggestions ?? undefined,
				createdAt: new Date(bigintToNumber(e.created_at) ?? Date.now()),
				// Handle dual format from Electric (string or object)
				nextStepSuggestion: e.next_step_suggestion
					? typeof e.next_step_suggestion === 'string'
						? JSON.parse(e.next_step_suggestion)
						: e.next_step_suggestion
					: undefined,
			}
		})
	}, [eventsQueryData, completedToolIds, approvalsByToolUseId, membersMap])

	// Tool results lookup
	const toolResultsByKey = useMemo(
		() => mapSyntheticSkillPromptsToToolResults(events, createToolResultsByKey(events)),
		[events],
	)
	const currentTurnEventIds = useMemo(() => getCurrentTurnEventIds(events), [events])

	// Agent grouping - moved before eventIds derivation for visible events calculation
	const { agentGroups, rootEvents: unfilteredRootEvents, hasSubAgents } = useAgentGrouping(events, toolResultsByKey)
	// Stable store action — deliberately no subscription to expandedAgents here:
	// this hook feeds the session detail provider, so subscribing would re-render
	// the whole page on every expand/collapse. Consumers that render expansion
	// state (WiredConversationStream, the rows) subscribe to the store themselves.
	const toggleAgentGroup = useExpansionStore((s) => s.toggle)

	/*
	 * HACK: Hide synthetic skill prompt injection messages from the UI.
	 *
	 * When a skill is invoked via the Skill tool, Claude Code and CodeLayer inject a synthetic
	 * user message containing the skill's SKILL.md content and arguments. The Claude SDK marks
	 * these with `isSynthetic: true`, but we don't currently store that flag in the database, so
	 * we detect them by content shape instead. We only hide TOP-LEVEL skill prompts — skill
	 * prompts inside subagent calls remain visible for debugging nested agent flows.
	 *
	 * Longer-term fix: store `isSynthetic` on conversation_events and filter on the flag.
	 */
	const rootEvents = useMemo(
		() =>
			unfilteredRootEvents.filter(
				(e) => !(e.role === 'user' && e.eventType === 'message' && isSyntheticSkillPromptMessage(e.content)),
			),
		[unfilteredRootEvents],
	)

	// Derive running sub-agents from agent groups for the interrupt confirmation dialog
	const runningSubAgents: RunningSubAgent[] = useMemo(
		() =>
			[...agentGroups.entries()]
				.filter(([, g]) => !g.parentAgent.isCompleted)
				.map(([toolId, g]) => {
					let displayName = 'Agent'
					let description = ''
					try {
						const agentInput = JSON.parse(g.parentAgent.toolInputJson || '{}')
						displayName = agentInput.subagent_type || 'Agent'
						description = agentInput.description || ''
					} catch {
						/* ignore parse errors */
					}
					return {
						id: toolId,
						displayName,
						description,
						toolCallCount: g.toolCallCount,
					}
				}),
		[agentGroups],
	)

	// Memoized list of pending approval event IDs for the indicator
	// Only recalculates when events change, not on every render
	const pendingApprovalEventIds = useMemo(
		() => events.filter((e) => e.approvalStatus === 'pending').map((e) => e.id),
		[events],
	)

	// Boolean flag for whether there are any pending approvals
	const hasPendingApprovals = pendingApprovalEventIds.length > 0

	// Memoized list of next step event IDs for the indicator
	const nextStepEventIds = useMemo(
		() => events.filter((e) => e.nextStepSuggestion?.extraction.type === 'next_step_found').map((e) => e.id),
		[events],
	)

	// Get label for the most recent next step (for the indicator beacon)
	const mostRecentNextStepLabel = useMemo(() => {
		const lastNextStepEvent = [...events]
			.reverse()
			.find((e) => e.nextStepSuggestion?.extraction.type === 'next_step_found')
		if (lastNextStepEvent?.nextStepSuggestion?.extraction.type === 'next_step_found') {
			return getNextStepButtonLabel(lastNextStepEvent.nextStepSuggestion.extraction.nextStepType)
		}
		return undefined
	}, [events])

	// Database event count - only actual events from Electric SQL, not expanded UI state
	const databaseEventCount = eventsQueryData?.length ?? 0

	return {
		savedEventIds,
		events,
		compactionSummaries,
		toolResultsByKey,
		currentTurnEventIds,
		agentGroups,
		rootEvents,
		hasSubAgents,
		toggleAgentGroup,
		runningSubAgents,
		pendingApprovalEventIds,
		hasPendingApprovals,
		nextStepEventIds,
		mostRecentNextStepLabel,
		databaseEventCount,
		showSenderNames,
	}
}
