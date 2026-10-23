import { buildAgentGroups, type ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useEffect, useMemo, useState } from 'react'

/**
 * Combined state for agent expansion.
 * By combining these into a single state object, we can make atomic updates
 * and avoid circular dependencies in the useEffect.
 */
interface ExpansionState {
	/** Currently expanded agent IDs */
	expanded: Set<string>
	/** Saved expansion state from before auto-expanding for approvals (null if not in auto-expand mode) */
	savedBeforeApproval: Set<string> | null
}

export function useAgentGrouping(events: ConversationEvent[], toolResultsByKey?: Record<string, ConversationEvent>) {
	const [expansionState, setExpansionState] = useState<ExpansionState>({
		expanded: new Set(),
		savedBeforeApproval: null,
	})

	// Use centralized buildAgentGroups from packages/ui
	const { agentGroups, rootEvents, hasSubAgents } = useMemo(
		() => buildAgentGroups(events, toolResultsByKey),
		[events, toolResultsByKey],
	)

	// Auto-expand agents with pending approvals
	// Note: This effect only depends on INPUTS (agentGroups, hasSubAgents), not on its own state output.
	// This breaks the circular dependency that was causing infinite loops.
	useEffect(() => {
		if (!hasSubAgents) {
			return
		}

		// Find all agents with pending approvals
		const agentsWithPendingApprovals = new Set<string>()
		agentGroups.forEach((group, agentId) => {
			if (group.hasPendingApproval) {
				agentsWithPendingApprovals.add(agentId)
			}
		})

		// Use functional updater to access current state without adding it to deps
		setExpansionState((prev) => {
			if (agentsWithPendingApprovals.size > 0) {
				// Check if we actually need to expand any new agents
				const needsExpanding = [...agentsWithPendingApprovals].some((id) => !prev.expanded.has(id))
				const needsToSaveState = prev.savedBeforeApproval === null

				// If nothing needs to change, return the same reference to prevent re-render
				if (!needsExpanding && !needsToSaveState) {
					return prev
				}

				// Create new state with expanded agents and saved pre-approval state
				const newState: ExpansionState = {
					expanded: new Set([...prev.expanded, ...agentsWithPendingApprovals]),
					savedBeforeApproval: prev.savedBeforeApproval ?? new Set(prev.expanded),
				}
				return newState
			}

			// No pending approvals - restore previous state if we had saved one
			if (prev.savedBeforeApproval !== null) {
				return {
					expanded: prev.savedBeforeApproval,
					savedBeforeApproval: null,
				}
			}

			// Nothing to do
			return prev
		})
	}, [agentGroups, hasSubAgents]) // ← No state in deps! Only inputs.

	const toggleAgentGroup = (agentId: string) => {
		setExpansionState((prev) => {
			const next = new Set(prev.expanded)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return { ...prev, expanded: next }
		})
	}

	// Return expandedAgents (the Set) for backwards compatibility with existing code
	return { agentGroups, rootEvents, hasSubAgents, expandedAgents: expansionState.expanded, toggleAgentGroup }
}
