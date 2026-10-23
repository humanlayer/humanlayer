import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useGitHubIssuePreviewSource } from '@/hooks/useGitHubIssuePreviewSource'
import { useTicketAutoFetch } from '@/hooks/useTicketAutoFetch'
import { parseLinearIssueInput } from '@/lib/linear-issue-input'
import { generateTaskSlug } from '@/lib/task-slug'
import type { LauncherV3TicketAttachment } from '@/modules/launcher-v3/launcher-v3-form'
import { ticketArtifactFileName } from '@/modules/launcher-v3/launcher-v3-launch'
import { useRiptideApi } from '@/orpc/client'

/** An issue the task starts from, shaped as the standard launcher's so the server imports it the same way. */
export type Ticket = LauncherV3TicketAttachment
export type TicketProvider = Ticket['provider']

export const PROVIDER_NAMES: Record<TicketProvider, string> = { linear: 'Linear', jira: 'Jira', github: 'GitHub' }

/**
 * Whether issues can come from `provider`, or it needs connecting first. GitHub counts as
 * connected once the organization has any installation; the dialog explains one that can't
 * read issues. Until the answer is in, it reads as connected so the menu doesn't flicker.
 */
export function useIssueSourceConnected(provider: TicketProvider): boolean {
	const { queryClient: api } = useRiptideApi()
	const tracker = useSettingsStore((state) =>
		provider === 'linear'
			? state.linearEnabled && !state.linearNeedsReauth
			: state.jiraEnabled && !state.jiraNeedsReauth,
	)
	const github = useQuery({
		...api.integrations.github.listConnections.queryOptions({ input: {}, context: { silent: true } }),
		enabled: provider === 'github',
	})
	if (provider !== 'github') return tracker
	return github.data ? github.data.connections.length > 0 : true
}

type Preview = { ticket: Ticket | null; error: string | null; loading: boolean }

/** A Jira key from `ABC-123` or a `…/browse/ABC-123` link. */
export function parseJiraKey(input: string): string | null {
	const key = input.trim().match(/(?:^|\/browse\/)([A-Z][A-Z0-9]+-\d+)\/?$/i)?.[1]
	return key ? key.toUpperCase() : null
}

/** The Linear or Jira issue an ID or link points at, looked up as you type. */
export function useTicketPreview(provider: 'linear' | 'jira', input: string): Preview {
	const debounced = useDebounce(input, 300)
	const jiraKey = parseJiraKey(debounced) ?? ''
	const fetched = useTicketAutoFetch({
		watchedMode: provider,
		debouncedTicketId: provider === 'linear' ? debounced : '',
		debouncedJiraTicketId: provider === 'jira' ? jiraKey : '',
	})
	const typing = input !== debounced
	const linear = provider === 'linear' ? parseLinearIssueInput(debounced) : null
	const id = linear ? (linear.ok ? linear.issueId.toUpperCase() : '') : jiraKey
	const name = provider === 'linear' ? fetched.linearName : fetched.jiraName
	const loading = typing || (provider === 'linear' ? fetched.isFetchingTicket : fetched.isFetchingJiraTicket)
	if (!debounced.trim() || typing) return { ticket: null, error: null, loading }
	if (!id) return { ticket: null, error: `Enter a ${PROVIDER_NAMES[provider]} issue ID or link`, loading }
	if (!name) {
		const lookup = provider === 'linear' ? fetched.linearLookupError : fetched.jiraLookupError
		const error = loading ? null : (lookup?.message ?? `Could not find ${id}. Check the ID and try again.`)
		return { ticket: null, error, loading }
	}
	const slug = provider === 'linear' ? fetched.linearSlug : fetched.jiraSlug
	const url = provider === 'linear' ? fetched.linearTicketUrl : fetched.jiraTicketUrl
	return {
		ticket: { provider, ticketId: id, name, slug: slug ?? generateTaskSlug(name), url, githubRepository: null },
		error: null,
		loading,
	}
}

/**
 * A GitHub issue by number in the chosen repository, or by link. The project's repository is
 * the first choice; a pasted link picks its own repository and leaves just the number.
 */
export function useGitHubTicketPreview({
	input,
	setInput,
	projectRepository,
}: {
	input: string
	setInput: (value: string) => void
	/** `owner/name` of the project's repository, when the task starts in a project. */
	projectRepository: string | null
}) {
	const github = useGitHubIssuePreviewSource({
		enabled: true,
		issueInput: input,
		setIssueInput: setInput,
		preferredRepositoryFullName: projectRepository,
	})
	const settled = useDebounce(input, 300) === input
	const repository = github.selectedRepository
	const preview: Preview = {
		ticket: github.preview && repository ? githubTicket(github.preview, repository) : null,
		error: github.isLoadingRepositories
			? null
			: (github.disabledReason ?? (input.trim() && settled ? github.inputError : null)),
		loading: github.isLoadingRepositories || github.isFetchingPreview || (input.trim() !== '' && !settled),
	}
	return {
		preview,
		repositories: github.repositories.filter((option) => !option.archived),
		repository,
		selectRepository: github.selectRepository,
		change: github.changeIssueInput,
	}
}

function githubTicket(
	issue: { issueNumber: number; title: string; url: string; repository: { fullName: string } },
	repository: NonNullable<Ticket['githubRepository']>,
): Ticket {
	const { fullName } = issue.repository
	return {
		provider: 'github',
		ticketId: String(issue.issueNumber),
		name: `[${fullName}#${issue.issueNumber}] ${issue.title}`,
		slug: `${fullName.replace('/', '-')}-${issue.issueNumber}-${generateTaskSlug(issue.title)}`.toLowerCase(),
		url: issue.url,
		githubRepository: repository,
	}
}

/** `owner/name` for a GitHub project repository, from its `github.com/owner/name` identity. */
export function githubFullName(repositoryIdentity: string | undefined): string | null {
	return repositoryIdentity?.startsWith('github.com/') ? repositoryIdentity.slice('github.com/'.length) : null
}

/** The task fields that tell the server which issue to import. */
export function ticketFields(ticket: Ticket | null) {
	if (!ticket) return {}
	const repository = ticket.githubRepository
	return {
		ticketProvider: ticket.provider,
		ticketId: ticket.ticketId,
		ticketUrl: ticket.url ?? undefined,
		githubConnectionId: repository?.connectionId,
		ticketRepositoryId: repository?.repositoryId,
		ticketRepositoryFullName: repository?.fullName,
	}
}

/** How the issue reads in copy: `ENG-123`, or `acme/app#42` for GitHub. */
export function ticketLabel(ticket: Ticket): string {
	return ticket.githubRepository ? `${ticket.githubRepository.fullName}#${ticket.ticketId}` : ticket.ticketId
}

/** The first prompt: what you typed, then a pointer to the imported issue so the agent reads it. */
export function withTicket(text: string, slug: string, ticket: Ticket | null): string {
	if (!ticket) return text
	const reference = `@.humanlayer/tasks/${slug}/${ticketArtifactFileName(ticket)}`
	return text.trim() ? `${text}\n\nSee ${reference}` : `Work on ${ticketLabel(ticket)}. See ${reference}`
}
