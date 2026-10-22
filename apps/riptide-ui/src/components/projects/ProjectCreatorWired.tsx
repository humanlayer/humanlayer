import type { ProjectV2 } from '@humanlayer/riptide-api-contract/api/projects-v2/schemas'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/orpc/client'
import { invalidateProjectsV2 } from '@/queries/projects-v2'

import { ProjectCreator, type ProjectGitHubRepository, type ProjectCreatorSubmission } from './ProjectCreator'

/**
 * The API-backed behavior shared by the settings page and Launcher V3 dialog.
 * ProjectCreator intentionally remains the reusable form; this component owns
 * the create mutation, GitHub suggestions, list invalidation, and success toast.
 */
export function ProjectCreatorWired({
	onCreated,
	onCancel,
	onSubmittingChange,
	formRef,
	repositoryPickerPortalContainer,
}: {
	readonly onCreated: (project: ProjectV2) => void | Promise<void>
	readonly onCancel: () => void
	readonly onSubmittingChange: (submitting: boolean) => void
	readonly formRef?: React.Ref<HTMLFormElement>
	readonly repositoryPickerPortalContainer?: HTMLElement | null
}) {
	const internalFormRef = useRef<HTMLFormElement>(null)
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const createMutation = useMutation(api.projects.v2.create.mutationOptions())
	const githubRepositories = useProjectGitHubRepositories()

	const create = async (submission: ProjectCreatorSubmission) => {
		const { project } = await createMutation.mutateAsync(submission)
		await invalidateProjectsV2(tanstackQueryClient)
		toast.success('Project created')
		await onCreated(project)
	}

	return (
		<ProjectCreator
			repositoryPickerPortalContainer={repositoryPickerPortalContainer}
			formRef={formRef ?? internalFormRef}
			onCreate={create}
			onCancel={onCancel}
			pending={createMutation.isPending}
			onSubmittingChange={onSubmittingChange}
			githubRepositories={githubRepositories.repositories}
			githubRepositoriesLoading={githubRepositories.loading}
			githubError={githubRepositories.error}
			githubConnected={githubRepositories.connected}
		/>
	)
}

function useProjectGitHubRepositories(): {
	readonly repositories: ReadonlyArray<ProjectGitHubRepository>
	readonly loading: boolean
	readonly connected: boolean
	readonly error?: string
} {
	const { queryClient: api } = useRiptideApi()
	const connectionsQuery = useQuery({
		...api.integrations.github.listConnections.queryOptions({ input: {}, context: { silent: true } }),
	})
	const connections =
		connectionsQuery.data?.enabled === true
			? connectionsQuery.data.connections.filter(
					(connection) =>
						connection.status === 'active' &&
						!connection.needsReauth &&
						connection.capabilities.listRepositories,
				)
			: []
	const repositoryQueries = useQueries({
		queries: connections.map((connection) => ({
			...api.integrations.github.listRepositories.queryOptions({
				input: { connectionId: connection.id },
				context: { silent: true },
			}),
		})),
	})
	const repositories = connections
		.flatMap((connection, index) =>
			(repositoryQueries[index]?.data?.repositories ?? []).map((repository) => ({
				connectionId: connection.id,
				repositoryId: repository.id,
				fullName: repository.fullName,
				accountLogin: connection.accountLogin,
				private: repository.private,
				archived: repository.archived,
				defaultBranch: repository.defaultBranch,
			})),
		)
		.sort((left, right) => left.fullName.localeCompare(right.fullName))

	return {
		repositories,
		connected: connections.length > 0,
		loading: connectionsQuery.isLoading || repositoryQueries.some((query) => query.isLoading),
		error:
			connectionsQuery.isError || repositoryQueries.some((query) => query.isError)
				? 'Could not load some GitHub repositories. Check the GitHub connection in cloud settings and try again.'
				: undefined,
	}
}
