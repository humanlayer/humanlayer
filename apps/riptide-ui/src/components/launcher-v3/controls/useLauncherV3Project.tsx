import { RadioGroup, RadioGroupItem } from '@humanlayer/ui/components/radio-group'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Loader2 } from 'lucide-react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { repositorySourceSummary } from '@/lib/repository-sources'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import {
	type LauncherProjectReadState,
	projectProjectLaunch,
	resolveProjectDefaultRepository,
} from '@/modules/launcher-v3/launcher-v3-project'
import { useRiptideApi } from '@/orpc/client'

type ReadyProjectState = Extract<LauncherProjectReadState, { status: 'ready' }>

function projectReadState(
	enabled: boolean,
	data: { project: ReadyProjectState['project']; location: ReadyProjectState['location'] } | undefined,
	error: Error | null,
): LauncherProjectReadState {
	if (!enabled) return { status: 'error', message: 'Projects V2 is disabled in Experiments.' }
	if (error) return { status: 'error', message: error.message }
	if (data) return { status: 'ready', project: data.project, location: data.location }
	return { status: 'loading' }
}

/**
 * Resolve the selected V2 project (recipe plus this host's saved location)
 * into a launch projection. Reads only; the form owns the selection.
 */
export function useLauncherV3Project(control: Control<LauncherV3FormValues>) {
	const projectId = useWatch({ control, name: 'projectId' })
	const hostId = useWatch({ control, name: 'hostId' })
	const slug = useWatch({ control, name: 'slug' })
	const defaultRepositoryIdentity = useWatch({ control, name: 'projectDefaultRepositoryIdentity' })
	const enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const { queryClient: api } = useRiptideApi()
	const query = useQuery({
		...api.projects.v2.get.queryOptions({
			input: { projectId: projectId ?? '', hostId: hostId ?? undefined },
		}),
		enabled: enabled && Boolean(projectId) && Boolean(hostId),
	})
	const sourcesQuery = useQuery({
		...api.projects.v2.repositorySources.get.queryOptions({
			input: { projectId: projectId ?? '', hostId: hostId ?? '' },
		}),
		enabled: enabled && Boolean(projectId) && Boolean(hostId),
	})
	// A restored draft may still name a project after the flag is turned off;
	// surface that as a blocker instead of loading forever.
	const readState = projectReadState(enabled, query.data, query.error)
	const projectForTaskSlug = (taskSlug: string) =>
		projectProjectLaunch({
			projectId,
			readState,
			defaultRepositoryIdentity,
			taskSlug,
		})
	return {
		projectId,
		hostId,
		readState,
		sourceSummary: repositorySourceSummary(sourcesQuery.data?.sources),
		projection: projectForTaskSlug(slug),
		projectForTaskSlug,
	}
}

/** Repository summary and default-repository choice for the selected project. */
export function LauncherProjectDrawerWired({
	control,
	disabled,
	project,
}: {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	project: ReturnType<typeof useLauncherV3Project>
}) {
	const { field: defaultRepository } = useController({ control, name: 'projectDefaultRepositoryIdentity' })
	if (!project.projectId) return null
	if (project.readState.status === 'loading') {
		return (
			<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
				<Loader2 className="size-3 animate-spin" />
				Loading project...
			</div>
		)
	}
	if (project.readState.status === 'error') {
		return (
			<div
				className="mt-2 border-l-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5 px-3 py-2 font-mono text-xs text-[var(--terminal-warning)]"
				role="alert"
			>
				Project could not be loaded. {project.readState.message}
			</div>
		)
	}
	const { project: recipe, location } = project.readState
	const selectedDefault = resolveProjectDefaultRepository(recipe, defaultRepository.value)
	const names = recipe.repositories.map((repository) => repository.repositoryIdentity.split('/').at(-1))
	return (
		<section
			className="mt-2 border border-border/60 bg-foreground/5 font-mono text-xs"
			aria-label="Project workspace"
		>
			<div className="flex items-center justify-between gap-3 p-3 text-muted-foreground">
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<span className="shrink-0">Project</span>
					<span className="truncate text-foreground" title={recipe.name}>
						{recipe.name}
					</span>
					<span className="truncate" title={names.join(', ')}>
						{names.join(', ')}
					</span>
				</span>
				{recipe.repositories.length > 1 && (
					<span className="shrink-0 uppercase tracking-wider">Sessions launch here by default</span>
				)}
			</div>
			{recipe.repositories.length > 1 && (
				<RadioGroup
					value={selectedDefault ?? ''}
					onValueChange={defaultRepository.onChange}
					className="block divide-y divide-border/40 border-t border-border/40 px-3"
				>
					{recipe.repositories.map((repository) => {
						const radioId = `launcher-v3-project-default-${repository.repositoryIdentity}`
						const path = location?.repositoryPaths[repository.repositoryIdentity]
						return (
							<label
								key={repository.repositoryIdentity}
								htmlFor={radioId}
								className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-muted/30"
							>
								<FolderGit2 aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-accent)]" />
								<span className="min-w-0 flex-1 truncate" title={path ?? repository.repositoryIdentity}>
									{repository.description ?? repository.repositoryIdentity}{' '}
									{path && <span className="text-muted-foreground">{path}</span>}
								</span>
								<RadioGroupItem
									id={radioId}
									value={repository.repositoryIdentity}
									disabled={disabled}
								/>
							</label>
						)
					})}
				</RadioGroup>
			)}
			<p className="border-t border-border/40 px-3 py-2 text-muted-foreground">{project.sourceSummary}</p>
			{project.projection.kind === 'blocked' && (
				<p className="px-3 pb-3 text-[var(--terminal-warning)]" role="alert">
					{project.projection.reason.message}
				</p>
			)}
		</section>
	)
}
