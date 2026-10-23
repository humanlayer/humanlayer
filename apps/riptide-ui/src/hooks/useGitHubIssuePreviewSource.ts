import { useQueries, useQuery } from '@tanstack/react-query'
import { useDebounce, useLocalStorage } from '@uidotdev/usehooks'
import { useCallback, useState } from 'react'

import type { GitHubRepositoryOption } from '@/components/GitHubRepositoryPicker'
import { parseGitHubIssueInput } from '@/lib/github-issue-input'
import { useRiptideApi } from '@/orpc/client'

const LAST_GITHUB_REPOSITORY_KEY = 'riptide:lastUsedGitHubRepository'

function previewErrorMessage(error: unknown): string | null {
	if (!error || typeof error !== 'object') return error ? 'Unable to preview this GitHub issue.' : null
	const topLevelMessage = 'message' in error ? error.message : undefined
	const data = 'data' in error ? error.data : undefined
	const dataMessage = data && typeof data === 'object' && 'message' in data ? data.message : undefined
	const code = typeof dataMessage === 'string' ? dataMessage : topLevelMessage
	switch (code) {
		case 'repository_mismatch':
			return 'The issue URL does not match the selected repository.'
		case 'github_installation_suspended':
			return 'This GitHub installation is suspended. Ask an administrator to restore it in GitHub.'
		case 'github_issues_permission_required':
			return 'This installation needs Issues: read permission before it can preview issues.'
		case 'github_integration_disabled':
			return 'GitHub issue import is disabled for this organization.'
		default:
			return typeof code === 'string' && code !== 'NOT_FOUND'
				? code
				: 'Issue not found or no longer accessible from this installation.'
	}
}

function githubDisabledReason({
	hasConnections,
	hasSuspendedConnections,
	hasPermissionBlockedConnections,
	hasUsableConnections,
	enabled,
	hasSelectableRepositories,
}: {
	hasConnections: boolean
	hasSuspendedConnections: boolean
	hasPermissionBlockedConnections: boolean
	hasUsableConnections: boolean
	enabled: boolean | undefined
	hasSelectableRepositories: boolean
}): string | null {
	if (!hasConnections) return 'Connect GitHub in organization settings to import an issue.'
	if (hasSuspendedConnections && !hasUsableConnections) return 'The installed GitHub connection is suspended.'
	if (hasPermissionBlockedConnections && !hasUsableConnections) {
		return 'The installed GitHub connection needs Issues: read permission.'
	}
	if (enabled === false) return 'GitHub issue import is disabled for this organization.'
	if (!hasSelectableRepositories) return 'No usable repositories are installed.'
	return null
}

export function useGitHubIssuePreviewSource(input: {
	readonly enabled: boolean
	readonly issueInput: string
	readonly setIssueInput: (value: string) => void
	readonly initialRepositoryId?: string | null
	readonly initialConnectionId?: string | null
	/** An `owner/name` to start on when nothing else is chosen, such as the project's repository. */
	readonly preferredRepositoryFullName?: string | null
}) {
	const { queryClient: api } = useRiptideApi()
	const [rememberedRepositoryKey, setRememberedRepositoryKey] = useLocalStorage<string | null>(
		LAST_GITHUB_REPOSITORY_KEY,
		null,
	)
	const [selectedRepositoryKey, setSelectedRepositoryKey] = useState<string | null>(null)

	const connectionsQuery = useQuery({
		...api.integrations.github.listConnections.queryOptions({ input: {}, context: { silent: true } }),
		enabled: input.enabled,
	})
	const usableConnections =
		connectionsQuery.data?.connections.filter(
			(connection) =>
				connection.status === 'active' && !connection.needsReauth && connection.capabilities.previewIssue,
		) ?? []
	const repositoryQueries = useQueries({
		queries: usableConnections.map((connection) => ({
			...api.integrations.github.listRepositories.queryOptions({
				input: { connectionId: connection.id },
				context: { silent: true },
			}),
			enabled: input.enabled,
		})),
	})

	const repositories: ReadonlyArray<GitHubRepositoryOption> = usableConnections.flatMap((connection, index) =>
		(repositoryQueries[index]?.data?.repositories ?? []).map((repository) => ({
			connectionId: connection.id,
			repositoryId: repository.id,
			fullName: repository.fullName,
			accountLogin: connection.accountLogin,
			private: repository.private,
			archived: repository.archived,
		})),
	)
	const selectableRepositories = repositories.filter((repository) => !repository.archived)
	const selectedRepository =
		selectableRepositories.find(
			(repository) => `${repository.connectionId}:${repository.repositoryId}` === selectedRepositoryKey,
		) ??
		selectableRepositories.find(
			(repository) =>
				repository.connectionId === input.initialConnectionId &&
				repository.repositoryId === input.initialRepositoryId,
		) ??
		selectableRepositories.find(
			(repository) => repository.fullName.toLowerCase() === input.preferredRepositoryFullName?.toLowerCase(),
		) ??
		selectableRepositories.find(
			(repository) => `${repository.connectionId}:${repository.repositoryId}` === rememberedRepositoryKey,
		) ??
		selectableRepositories[0] ??
		null

	const selectRepository = useCallback(
		(repository: GitHubRepositoryOption) => {
			const repositoryKey = `${repository.connectionId}:${repository.repositoryId}`
			setSelectedRepositoryKey(repositoryKey)
			setRememberedRepositoryKey(repositoryKey)
		},
		[setRememberedRepositoryKey],
	)

	const parsedInput = input.issueInput.trim() ? parseGitHubIssueInput(input.issueInput) : null
	const inputRepositoryIsInstalled =
		parsedInput?.ok === true && parsedInput.repositoryFullName !== null
			? selectableRepositories.some(
					(repository) => repository.fullName.toLowerCase() === parsedInput.repositoryFullName?.toLowerCase(),
				)
			: true
	const localInputError =
		parsedInput && !parsedInput.ok
			? parsedInput.message
			: !inputRepositoryIsInstalled
				? 'The repository in this URL is not installed for your organization.'
				: null
	const debouncedIssueInput = useDebounce(input.issueInput, 300)
	const debouncedParsedInput = debouncedIssueInput.trim() ? parseGitHubIssueInput(debouncedIssueInput) : null

	const previewQuery = useQuery({
		...api.integrations.github.getIssuePreview.queryOptions({
			input: {
				connectionId: selectedRepository?.connectionId ?? '00000000-0000-0000-0000-000000000000',
				repositoryId: selectedRepository?.repositoryId ?? '0',
				issueInput: debouncedIssueInput,
			},
			context: { silent: true },
		}),
		enabled:
			input.enabled &&
			selectedRepository !== null &&
			debouncedParsedInput?.ok === true &&
			(debouncedParsedInput.repositoryFullName === null ||
				debouncedParsedInput.repositoryFullName.toLowerCase() === selectedRepository.fullName.toLowerCase()),
	})

	const changeIssueInput = useCallback(
		(value: string) => {
			const parsedValue = parseGitHubIssueInput(value)
			if (parsedValue.ok && parsedValue.repositoryFullName) {
				const matchingRepository = selectableRepositories.find(
					(repository) => repository.fullName.toLowerCase() === parsedValue.repositoryFullName?.toLowerCase(),
				)
				if (matchingRepository) {
					selectRepository(matchingRepository)
					input.setIssueInput(String(parsedValue.issueNumber))
					return
				}
			}
			input.setIssueInput(value)
		},
		[input, selectableRepositories, selectRepository],
	)

	const hasConnections = (connectionsQuery.data?.connections.length ?? 0) > 0
	const hasSuspendedConnections = connectionsQuery.data?.connections.some(
		(connection) => connection.status === 'suspended',
	)
	const hasPermissionBlockedConnections = connectionsQuery.data?.connections.some(
		(connection) => !connection.capabilities.previewIssue,
	)
	const disabledReason = githubDisabledReason({
		hasConnections,
		hasSuspendedConnections: hasSuspendedConnections === true,
		hasPermissionBlockedConnections: hasPermissionBlockedConnections === true,
		hasUsableConnections: usableConnections.length > 0,
		enabled: connectionsQuery.data?.enabled,
		hasSelectableRepositories: selectableRepositories.length > 0,
	})

	return {
		repositories,
		selectedRepository,
		selectRepository,
		changeIssueInput,
		preview: previewQuery.data ?? null,
		isLoadingRepositories: connectionsQuery.isLoading || repositoryQueries.some((query) => query.isLoading),
		isFetchingPreview: previewQuery.isFetching,
		inputError: localInputError ?? previewErrorMessage(previewQuery.error),
		isEnabled: connectionsQuery.data?.enabled === true && selectableRepositories.length > 0,
		disabledReason,
	}
}
