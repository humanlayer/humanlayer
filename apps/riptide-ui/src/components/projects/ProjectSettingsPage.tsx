import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@humanlayer/ui/components/hover-card'
import { Input } from '@humanlayer/ui/components/input'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Archive, ChevronRight, CircleHelp, FolderCog, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { getHostId as getDesktopHostId } from '@/integrations/desktop/host'
import { cn } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'
import { invalidateProjectsV2, projectsV2ListQuery } from '@/queries/projects-v2'

import { RepositorySourceSetupDialogWired } from '../RepositorySourceSetupDialog'
import { AddRepositoriesDialog } from './AddRepositoriesDialog'
import { ProjectArchiveConfirmDialog } from './ProjectArchiveConfirmDialog'
import { ProjectEditDialog } from './ProjectEditDialog'
import { RepositorySetupDialog } from './RepositorySetupDialog'

type Project = RiptideApiOutputs['projects']['v2']['list']['projects'][number]

export function ProjectSettingsPage() {
	const enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const navigate = useNavigate()
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const listOptions = projectsV2ListQuery(api)
	const projectsQuery = useQuery({ ...listOptions, enabled })
	const archiveMutation = useMutation(api.projects.v2.archive.mutationOptions())

	// Rows are expanded by default; tracking the collapsed set (rather than the
	// expanded set) gives that default without any effect syncing state to data.
	const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(new Set())
	const [projectFilter, setProjectFilter] = useState('')
	const [archiveTarget, setArchiveTarget] = useState<Project | null>(null)

	const refresh = async () => {
		await invalidateProjectsV2(tanstackQueryClient)
	}

	const projects = projectsQuery.data?.projects ?? []
	const normalizedFilter = projectFilter.toLowerCase().trim()
	const filteredProjects = normalizedFilter
		? projects.filter(
				(project) =>
					project.name.toLowerCase().includes(normalizedFilter) ||
					(project.description ?? '').toLowerCase().includes(normalizedFilter) ||
					project.repositories.some((repo) =>
						repo.repositoryIdentity.toLowerCase().includes(normalizedFilter),
					),
			)
		: projects

	if (!enabled)
		return (
			<p className="text-sm text-muted-foreground">
				Enable Projects V2 in Experiments to manage project recipes.
			</p>
		)

	const toggleProject = (projectId: string) => {
		setCollapsedProjectIds((previous) => {
			const next = new Set(previous)
			if (next.has(projectId)) next.delete(projectId)
			else next.add(projectId)
			return next
		})
	}

	const archive = async () => {
		if (!archiveTarget) return
		try {
			await archiveMutation.mutateAsync({ projectId: archiveTarget.id, archived: true })
			await refresh()
			setArchiveTarget(null)
			toast.success('Project archived')
		} catch {
			toast.error('Failed to archive project')
		}
	}

	return (
		<div className="space-y-6">
			<p className="text-sm leading-relaxed text-muted-foreground">
				<strong className="font-medium text-foreground">Projects</strong> are reusable selections or groups of
				repositories. A Project serves as a template for a{' '}
				<strong className="font-medium text-foreground">Workspace</strong>, which is the bundle of Git worktrees
				that are created when you start work on a task.
				<HoverCard openDelay={150}>
					<HoverCardTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="ml-1 size-6 align-middle text-muted-foreground"
							aria-label="What are projects, workspaces, and tasks?"
						>
							<CircleHelp className="size-3.5" />
						</Button>
					</HoverCardTrigger>
					<HoverCardContent className="w-96">
						<ProjectGlossary />
					</HoverCardContent>
				</HoverCard>
			</p>

			<div className="flex items-center gap-2">
				<h3 className="text-sm font-semibold">Your projects</h3>
				<Input
					aria-label="Filter projects"
					value={projectFilter}
					onChange={(event) => setProjectFilter(event.target.value)}
					placeholder="Filter projects…"
					className="ml-auto w-56"
				/>
				<Button size="sm" onClick={() => navigate({ to: '/settings/projects/new', replace: true })}>
					<Plus className="size-3.5" />
					New project
				</Button>
			</div>

			{projectsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

			{!projectsQuery.isLoading && projects.length === 0 && (
				<p className="text-sm text-muted-foreground">No projects yet. Create one to get started.</p>
			)}

			{projects.length > 0 && filteredProjects.length === 0 && (
				<p className="text-sm text-muted-foreground">No projects match your filter.</p>
			)}

			{filteredProjects.length > 0 && (
				<div className="space-y-4">
					{filteredProjects.map((project) => (
						<ProjectRow
							key={project.id}
							project={project}
							expanded={!collapsedProjectIds.has(project.id)}
							onToggle={() => toggleProject(project.id)}
							onRefresh={refresh}
							onArchive={() => setArchiveTarget(project)}
						/>
					))}
				</div>
			)}

			{archiveTarget && (
				<ProjectArchiveConfirmDialog
					projectName={archiveTarget.name}
					pending={archiveMutation.isPending}
					onConfirm={() => void archive()}
					onCancel={() => setArchiveTarget(null)}
				/>
			)}
		</div>
	)
}

function ProjectRow({
	project,
	expanded,
	onToggle,
	onRefresh,
	onArchive,
}: {
	readonly project: Project
	readonly expanded: boolean
	readonly onToggle: () => void
	readonly onRefresh: () => Promise<void>
	readonly onArchive: () => void
}) {
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const updateMutation = useMutation(api.projects.v2.update.mutationOptions())
	const upsertLocationMutation = useMutation(api.projects.v2.locations.upsert.mutationOptions())

	const [editOpen, setEditOpen] = useState(false)
	const [addOpen, setAddOpen] = useState(false)
	const [sourceHostId, setSourceHostId] = useState<string | null>(null)
	const [setupIdentity, setSetupIdentity] = useState<string | null>(null)
	const { user } = useAuth()
	const { hostId: effectiveHostId, availableHosts } = useEffectiveHost()
	const canEdit = user?.id === project.resourceOwnerUserId
	const openRepositorySources = () => {
		if (!effectiveHostId) {
			toast.error('No execution host is online')
			return
		}
		setSourceHostId(effectiveHostId)
	}
	const sourceHostName =
		availableHosts.find((host) => host.host_id === sourceHostId)?.host_name ?? sourceHostId?.slice(0, 8) ?? ''

	const removeRepository = async (repositoryIdentity: string) => {
		if (!canEdit || updateMutation.isPending) return
		try {
			const remaining = project.repositories.filter((repo) => repo.repositoryIdentity !== repositoryIdentity)
			if (remaining.length === 0) return
			const repositories = remaining.some((repo) => repo.default)
				? remaining
				: remaining.map((repo, index) => (index === 0 ? { ...repo, default: true } : repo))
			await updateMutation.mutateAsync({ projectId: project.id, repositories })
			try {
				const hostId = await getDesktopHostId()
				if (hostId) {
					const { location } = await tanstackQueryClient.fetchQuery(
						api.projects.v2.get.queryOptions({ input: { projectId: project.id, hostId } }),
					)
					if (location) {
						const identities = new Set(repositories.map((repo) => repo.repositoryIdentity))
						await upsertLocationMutation.mutateAsync({
							projectId: project.id,
							hostId,
							repositoryPaths: Object.fromEntries(
								Object.entries(location.repositoryPaths).filter(([identity]) =>
									identities.has(identity),
								),
							),
						})
					}
				}
			} catch {
				// The recipe is authoritative; stale path mappings are dropped on the next location write.
			}
			await onRefresh()
			toast.success('Repository removed')
		} catch {
			toast.error('Failed to remove repository')
		}
	}

	return (
		<div className="bg-muted/50">
			<div className="flex items-center gap-1 pr-2">
				<button
					type="button"
					aria-expanded={expanded}
					className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
					onClick={onToggle}
				>
					<ChevronRight
						className={cn(
							'size-3.5 shrink-0 text-muted-foreground transition-transform',
							expanded && 'rotate-90',
						)}
					/>
					<span className="truncate text-sm font-medium">{project.name}</span>
					{project.private && (
						<Badge variant="outline" className="shrink-0 text-[10px]">
							private
						</Badge>
					)}
					<span className="shrink-0 text-xs text-muted-foreground">
						{project.repositories.length}{' '}
						{project.repositories.length === 1 ? 'repository' : 'repositories'}
					</span>
				</button>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 shrink-0 text-muted-foreground hover:text-accent"
					aria-label={`Edit repository sources for ${project.name}`}
					onClick={openRepositorySources}
				>
					<FolderCog className="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 shrink-0 text-muted-foreground hover:text-accent"
					aria-label={`Edit ${project.name}`}
					disabled={!canEdit}
					onClick={() => setEditOpen(true)}
				>
					<Pencil className="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 shrink-0 text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
					aria-label={`Archive ${project.name}`}
					disabled={!canEdit}
					onClick={onArchive}
				>
					<Archive className="size-3.5" />
				</Button>
			</div>

			{expanded && (
				<div className="px-3 pb-2.5 pl-9">
					{project.repositories.map((repo, index) => (
						<div
							key={repo.repositoryIdentity}
							className={cn(
								'flex flex-wrap items-center justify-between gap-3 py-2',
								index > 0 && 'border-t border-border/50',
							)}
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium">
										{repo.repositoryIdentity.split('/').pop()}
									</span>
									{repo.default && (
										<Badge variant="outline" className="shrink-0 text-[10px]">
											default
										</Badge>
									)}
								</div>
								<div className="truncate text-xs text-muted-foreground">{repo.repositoryIdentity}</div>
							</div>
							<div className="flex shrink-0 items-center gap-3">
								<span className="text-xs text-muted-foreground">
									{repo.copyGlobs.length
										? `${repo.copyGlobs.length} ${repo.copyGlobs.length === 1 ? 'glob' : 'globs'}`
										: 'No files'}
								</span>
								<span className="text-xs text-muted-foreground">
									{repo.setupCommand?.trim() ? 'Setup configured' : 'No setup command'}
								</span>
								<span className="text-xs text-muted-foreground">{repo.defaultBranch}</span>
								<Button
									size="xs"
									variant="outline"
									aria-haspopup="dialog"
									aria-label={`Edit setup for ${repo.repositoryIdentity}`}
									disabled={!canEdit || updateMutation.isPending}
									onClick={() => setSetupIdentity(repo.repositoryIdentity)}
								>
									Edit
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="size-7 text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
									aria-label={`Remove ${repo.repositoryIdentity}`}
									disabled={!canEdit || project.repositories.length === 1 || updateMutation.isPending}
									onClick={() => void removeRepository(repo.repositoryIdentity)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						</div>
					))}
					<div className="border-t border-border/50 pt-2">
						<Button
							size="xs"
							variant="outline"
							disabled={!canEdit || updateMutation.isPending}
							onClick={() => setAddOpen(true)}
						>
							<Plus className="size-3" />
							Add repositories
						</Button>
					</div>
				</div>
			)}

			{setupIdentity && (
				<RepositorySetupDialog
					key={setupIdentity}
					project={project}
					identity={setupIdentity}
					onClose={() => setSetupIdentity(null)}
					onSaved={onRefresh}
				/>
			)}
			{editOpen && <ProjectEditDialog project={project} onClose={() => setEditOpen(false)} onSaved={onRefresh} />}
			{sourceHostId && (
				<RepositorySourceSetupDialogWired
					key={`${project.id}:${sourceHostId}`}
					project={project}
					hostId={sourceHostId}
					hostName={sourceHostName}
					mode="settings"
					onCancel={() => setSourceHostId(null)}
					onSaved={async () => {
						await onRefresh()
						setSourceHostId(null)
					}}
				/>
			)}
			{addOpen && (
				<AddRepositoriesDialog project={project} onClose={() => setAddOpen(false)} onChanged={onRefresh} />
			)}
		</div>
	)
}

function ProjectGlossary() {
	return (
		<div className="space-y-2 text-xs text-muted-foreground">
			<p>
				<strong className="font-medium text-foreground">Project</strong> = a set of repositories used as a
				template for a workspace
			</p>
			<p>
				<strong className="font-medium text-foreground">Workspace</strong> = worktree(s) created from a project
				that you run tasks in
			</p>
			<p>
				<strong className="font-medium text-foreground">Task</strong> = a bundle of coding agent sessions that
				share collaborative artifacts, context, and diffs; often maps 1-1 with a Linear task, Jira ticket,
				GitHub issue, or other discrete change you want to make across one or more repositories
			</p>
		</div>
	)
}
