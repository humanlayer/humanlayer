import type { ProjectV2 } from '@humanlayer/riptide-api-contract/api/projects-v2/schemas'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Archive, Check, FolderGit2, MoreHorizontal, Settings } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CreateProjectDialog } from '@/components/launcher-v3/CreateProjectDialog'
import { ProjectArchiveConfirmDialog } from '@/components/projects/ProjectArchiveConfirmDialog'
import { ProjectExplanation } from '@/components/projects/ProjectExplanation'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRiptideApi } from '@/orpc/client'
import { invalidateProjectsV2, projectsV2ListQuery } from '@/queries/projects-v2'

export interface ProjectOnboardingState {
	readonly enabled: boolean
	readonly hasUsableProject: boolean
	readonly projectCount: number
	readonly loading: boolean
	readonly projects: readonly ProjectV2[]
}

/**
 * Project onboarding completion is intentionally derived from the readable,
 * non-archived project list. It is not a historical user-settings milestone.
 */
export function useProjectOnboardingState(): ProjectOnboardingState {
	const enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const { queryClient: api } = useRiptideApi()
	const projectsQuery = useQuery({ ...projectsV2ListQuery(api), enabled })
	const projectCount = projectsQuery.data?.projects.length ?? 0
	return {
		enabled,
		hasUsableProject: projectCount > 0,
		projectCount,
		loading: projectsQuery.isLoading,
		projects: projectsQuery.data?.projects ?? [],
	}
}

export function OnboardingProjectList({
	projects,
	selectedProjectId,
	onSelectProject,
	onConfigureProject,
	onArchiveProject,
}: {
	readonly projects: readonly ProjectV2[]
	readonly selectedProjectId: string | null
	readonly onSelectProject: (projectId: string) => void
	readonly onConfigureProject: (project: ProjectV2) => void
	readonly onArchiveProject: (project: ProjectV2) => void
}) {
	return (
		<div className="space-y-2" aria-label="Available projects">
			{projects.map((project) => {
				const selected = project.id === selectedProjectId
				return (
					<div
						key={project.id}
						className={`flex items-center border ${selected ? 'border-accent bg-accent/10 text-foreground' : 'border-border'}`}
					>
						<button
							type="button"
							aria-pressed={selected}
							onClick={() => onSelectProject(project.id)}
							className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left hover:bg-accent/10"
						>
							<FolderGit2 className="mt-0.5 size-4 shrink-0 text-accent" />
							<span className="min-w-0 flex-1">
								<span className="block font-medium">{project.name}</span>
								<span className="block text-xs text-muted-foreground">
									{project.description ?? 'No description'}
								</span>
							</span>
						</button>
						<div className="flex shrink-0 items-center gap-1 pr-2">
							<span className="flex size-7 items-center justify-center">
								{selected && <Check aria-label="Selected" className="size-4 text-accent" />}
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="size-7 text-muted-foreground"
										aria-label={`Manage ${project.name}`}
									>
										<MoreHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => onConfigureProject(project)}>
										<Settings className="size-3.5" />
										Configure project
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-destructive focus:text-destructive"
										onSelect={() => onArchiveProject(project)}
									>
										<Archive className="size-3.5" />
										Archive project
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				)
			})}
		</div>
	)
}

export function OnboardingProjectPicker({
	projects,
	selectedProjectId,
	onSelectProject,
}: {
	readonly projects: readonly ProjectV2[]
	readonly selectedProjectId: string | null
	readonly onSelectProject: (projectId: string | null) => void
}) {
	const { queryClient: api } = useRiptideApi()
	const navigate = useNavigate()
	const tanstackQueryClient = useQueryClient()
	const archiveMutation = useMutation(api.projects.v2.archive.mutationOptions())
	const [archiveTarget, setArchiveTarget] = useState<ProjectV2 | null>(null)
	const refresh = () => invalidateProjectsV2(tanstackQueryClient)
	const archive = async () => {
		if (!archiveTarget) return
		try {
			await archiveMutation.mutateAsync({ projectId: archiveTarget.id, archived: true })
			if (selectedProjectId === archiveTarget.id) onSelectProject(null)
			setArchiveTarget(null)
			await refresh()
			toast.success('Project archived')
		} catch {
			toast.error('Failed to archive project')
		}
	}

	return (
		<>
			<OnboardingProjectList
				projects={projects}
				selectedProjectId={selectedProjectId}
				onSelectProject={onSelectProject}
				onConfigureProject={() => void navigate({ to: '/settings/projects' })}
				onArchiveProject={setArchiveTarget}
			/>
			{archiveTarget && (
				<ProjectArchiveConfirmDialog
					projectName={archiveTarget.name}
					pending={archiveMutation.isPending}
					onConfirm={() => void archive()}
					onCancel={() => setArchiveTarget(null)}
				/>
			)}
		</>
	)
}

export function CreateFirstProjectStep({
	state,
	onCreateTask,
	onProjectCreated,
	selectedProjectId = null,
	onSelectProject = () => {},
}: {
	readonly state: ProjectOnboardingState
	readonly onCreateTask: () => void
	readonly onProjectCreated?: (project: ProjectV2) => void
	readonly selectedProjectId?: string | null
	readonly onSelectProject?: (projectId: string | null) => void
}) {
	const [createProjectOpen, setCreateProjectOpen] = useState(false)

	if (state.loading) return <p>Checking available projects…</p>

	if (state.hasUsableProject) {
		return (
			<div className="space-y-3">
				<OnboardingProjectPicker
					projects={state.projects}
					selectedProjectId={selectedProjectId}
					onSelectProject={onSelectProject}
				/>
			</div>
		)
	}

	return (
		<div className="space-y-3">
			<ProjectExplanation />
			<div className="flex flex-wrap gap-2">
				<Button onClick={() => setCreateProjectOpen(true)}>Create a project</Button>
				<Button variant="ghost" onClick={onCreateTask}>
					Use a directory instead
				</Button>
			</div>
			<CreateProjectDialog
				open={createProjectOpen}
				onOpenChange={setCreateProjectOpen}
				onCreated={onProjectCreated ?? (() => {})}
			/>
		</div>
	)
}
