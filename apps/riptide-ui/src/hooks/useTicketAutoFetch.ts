import { useQuery } from '@tanstack/react-query'

import { parseLinearIssueInput } from '@/lib/linear-issue-input'
import { generateTaskSlug } from '@/lib/task-slug'
import { getTicketLookupError } from '@/lib/ticket-lookup-error'
import { useRiptideApi } from '@/orpc/client'

function isPlausibleJiraKey(key: string): boolean {
	return /^[A-Z][A-Z0-9]+-\d+$/i.test(key)
}

/**
 * Handles debounced ticket auto-fetching for both Linear and Jira modes.
 * Returns query data — the parent derives form values from it.
 */
export function useTicketAutoFetch({
	watchedMode,
	debouncedTicketId,
	debouncedJiraTicketId,
}: {
	watchedMode: string
	debouncedTicketId: string
	debouncedJiraTicketId: string
}) {
	const { queryClient: api } = useRiptideApi()

	const parsedLinearInput = parseLinearIssueInput(debouncedTicketId ?? '')
	const normalizedLinearId = parsedLinearInput.ok ? parsedLinearInput.issueId : ''
	const trimmedJiraId = debouncedJiraTicketId?.trim() ?? ''

	// Linear metadata (identifier, title, url, branch)
	const linearMetadata = useQuery({
		...api.integrations.linear.getIssueMetadata.queryOptions({
			input: { issueId: normalizedLinearId },
			context: { silent: true },
		}),
		enabled: watchedMode === 'linear' && parsedLinearInput.ok,
	})

	// Jira issue
	const jiraIssue = useQuery({
		...api.integrations.jira.getIssue.queryOptions({
			input: { issueKey: trimmedJiraId },
			context: { silent: true },
		}),
		enabled: watchedMode === 'jira' && isPlausibleJiraKey(trimmedJiraId),
	})

	// Derive Linear slug from metadata
	const linearSlug = linearMetadata.data
		? (() => {
				const rawBranch = linearMetadata.data.branch
				if (rawBranch) {
					return rawBranch.includes('/') ? rawBranch.split('/').slice(1).join('/') : rawBranch
				}
				return linearMetadata.data.identifier.toLowerCase()
			})()
		: null

	// Derive Linear display name
	const linearName = linearMetadata.data ? `[${linearMetadata.data.identifier}] ${linearMetadata.data.title}` : null

	// Derive Jira values
	const jiraName = jiraIssue.data ? `[${trimmedJiraId.toUpperCase()}] ${jiraIssue.data.summary}` : null

	const jiraSlug = jiraIssue.data
		? `${trimmedJiraId.toLowerCase()}-${generateTaskSlug(jiraIssue.data.summary)}`
		: null

	const linearLookupError = watchedMode === 'linear' ? getTicketLookupError(linearMetadata.error) : null
	const jiraLookupError = watchedMode === 'jira' ? getTicketLookupError(jiraIssue.error) : null

	return {
		// Loading states
		isFetchingTicket: linearMetadata.isFetching,
		isFetchingJiraTicket: jiraIssue.isFetching,

		// Linear derived data
		linearName,
		linearSlug,
		linearTicketUrl: linearMetadata.data?.url ?? null,
		linearLookupError,

		// Jira derived data
		jiraName,
		jiraSlug,
		jiraTicketUrl: jiraIssue.data?.url ?? null,
		jiraLookupError,
	}
}
