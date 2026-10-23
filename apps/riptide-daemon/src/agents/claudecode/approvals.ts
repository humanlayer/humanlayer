import type { Approval } from '@humanlayer/db/tables/approvals'
import {
	type ParseSuggestionsOnDropped,
	type PermissionUpdate,
	parseSuggestions,
} from '@humanlayer/db/zodschemas/permission-update'
import * as Sentry from '@sentry/bun'

import logger from '@/logger'

import type { DaemonServices } from './types'

/**
 * Report dropped applied-suggestion entries via logger + Sentry so we notice
 * SDK shape drift or legacy rows that no longer match the schema.
 */
function reportDroppedSuggestion(approvalId: string | undefined): ParseSuggestionsOnDropped {
	return ({ reason, entry, error }) => {
		logger.warn({ approvalId, reason, entry, error }, 'Dropped applied permission suggestion')
		const err = error instanceof Error ? error : new Error(`Dropped applied permission suggestion: ${reason}`)
		Sentry.captureException(err, {
			level: 'warning',
			tags: { component: 'claudecode.approvals', reason },
			extra: { approvalId, entry },
		})
	}
}

export function parseAppliedSuggestions(
	approval: Pick<Approval, 'id' | 'applied_suggestions'>,
): PermissionUpdate[] | undefined {
	return parseSuggestions(approval.applied_suggestions, reportDroppedSuggestion(approval.id))
}

type ApprovalChangeMessage = {
	type: 'insert' | 'update' | 'delete'
	value: Omit<Approval, 'status'> & { readonly status: string }
	previousValue?: Omit<Approval, 'status'> & { readonly status: string }
}

/**
 * Check if a status represents a resolved approval.
 * Explicit check is clearer than `!== 'pending'`.
 */
export function isResolvedStatus(status: string): status is 'approved' | 'denied' {
	return status === 'approved' || status === 'denied'
}

/**
 * Check if a change message represents an approval being resolved.
 */
export function isApprovalResolvedEvent(change: ApprovalChangeMessage, approvalId: string): boolean {
	if (change.value.id !== approvalId) {
		return false
	}

	// Must be a resolved status (approved or denied)
	if (!isResolvedStatus(change.value.status)) {
		return false
	}

	// Insert of already-resolved approval counts as resolved event
	if (change.type === 'insert') {
		return true
	}

	// Update from pending → resolved
	if (change.type === 'update' && change.previousValue?.status === 'pending') {
		return true
	}

	return false
}

function isAllowedByAppliedRule(ruleContent: string | undefined, input: Record<string, unknown>): boolean {
	if (!ruleContent) return true

	const command = typeof input.command === 'string' ? input.command : undefined
	if (!command) return false
	if (command === ruleContent) return true

	const pattern = `^${ruleContent.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
	return new RegExp(pattern).test(command)
}

export function isAllowedByAppliedSuggestions(
	sessionId: string,
	toolName: string,
	input: Record<string, unknown>,
	approvalsCollection: DaemonServices['collections']['approvals'],
): boolean {
	for (const approval of approvalsCollection.state.values()) {
		if (approval.session_id !== sessionId || approval.status !== 'approved') continue

		for (const suggestion of parseAppliedSuggestions(approval) ?? []) {
			if (suggestion.type !== 'addRules' || suggestion.behavior !== 'allow') continue

			for (const rule of suggestion.rules) {
				if (rule.toolName === toolName && isAllowedByAppliedRule(rule.ruleContent, input)) return true
			}
		}
	}

	return false
}
