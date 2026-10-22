import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useIsColocated } from '@/hooks/use-colocated'
import { pickExistingDirectory } from '@/integrations/desktop/directory-picker'
import { setLastTaskLauncherLocation } from '@/lib/preferences'
import { isDesktop } from '@/lib/utils'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { useRiptideApi } from '@/orpc/client'
import { projectsV2ListQuery } from '@/queries/projects-v2'

import {
	LauncherDirectoryControl,
	type LauncherDirectoryControlState,
	type LauncherDirectoryProjectOption,
} from './LauncherDirectoryControl'

export interface LauncherDirectoryControlWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	onCreateProject?: () => void
}

export function LauncherDirectoryControlWired({
	control,
	disabled,
	onCreateProject,
}: LauncherDirectoryControlWiredProps) {
	const { field: directory } = useController({ control, name: 'directory' })
	const { field: excludedRepositories } = useController({ control, name: 'excludedRepositoryLocalPaths' })
	const { field: defaultRepository } = useController({ control, name: 'defaultLaunchRepositoryLocalPath' })
	const { field: project } = useController({ control, name: 'projectId' })
	const { field: projectDefaultRepository } = useController({ control, name: 'projectDefaultRepositoryIdentity' })
	const hostId = useWatch({ control, name: 'hostId' })
	const projectsV2Enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const { queryClient: api } = useRiptideApi()
	const projectsQuery = useQuery({ ...projectsV2ListQuery(api), enabled: projectsV2Enabled })
	const projects: readonly LauncherDirectoryProjectOption[] = (
		projectsV2Enabled && !projectsQuery.isError ? (projectsQuery.data?.projects ?? []) : []
	).map((item) => ({
		id: item.id,
		name: item.name,
		repositoryCount: item.repositories.length,
	}))
	return (
		<LauncherDirectoryControlWiredForValue
			key={`${hostId ?? 'no-host'}:${directory.value}:${project.value ?? ''}`}
			disabled={disabled}
			directory={directory}
			hostId={hostId}
			projects={projects}
			selectedProjectId={project.value}
			onCreateProject={projectsV2Enabled ? onCreateProject : undefined}
			onDirectorySelectionChange={(nextDirectory) => {
				excludedRepositories.onChange([])
				defaultRepository.onChange(null)
				if (project.value !== null) project.onChange(null)
				if (projectDefaultRepository.value !== null) projectDefaultRepository.onChange(null)
				if (hostId) setLastTaskLauncherLocation(hostId, { type: 'directory', directory: nextDirectory })
			}}
			onProjectSelectionChange={(projectId) => {
				if (project.value === projectId) return
				project.onChange(projectId)
				projectDefaultRepository.onChange(null)
				if (hostId) setLastTaskLauncherLocation(hostId, { type: 'project', projectId })
			}}
		/>
	)
}

function LauncherDirectoryControlWiredForValue({
	disabled,
	directory,
	hostId,
	projects,
	selectedProjectId,
	onCreateProject,
	onDirectorySelectionChange,
	onProjectSelectionChange,
}: Pick<LauncherDirectoryControlWiredProps, 'disabled'> & {
	directory: ReturnType<typeof useController<LauncherV3FormValues, 'directory'>>['field']
	hostId: string | null
	projects: readonly LauncherDirectoryProjectOption[]
	selectedProjectId: string | null
	onCreateProject?: () => void
	onDirectorySelectionChange: (directory: string) => void
	onProjectSelectionChange: (projectId: string) => void
}) {
	const { user } = useAuth()
	const recentDirectories = useRecentDirectories(hostId ?? undefined, user?.id)
	const { isColocated } = useIsColocated(hostId)
	const [open, setOpen] = useState(false)
	const [draftDirectory, setDraftDirectory] = useState<string | null>(null)
	const filteredRecentDirectories = recentDirectories.filter((path) => path !== directory.value).slice(0, 5)

	const useFilesystem = isDesktop() && isColocated
	const state: LauncherDirectoryControlState = hostId
		? {
				status: 'ready',
				useFilesystem,
				recentDirectories: filteredRecentDirectories,
				// Recipes are path-free; the selected daemon materializes the workspace.
				projects,
			}
		: { status: 'host-required' }
	const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
	const commitDirectory = useCallback(
		(nextDirectory: string) => {
			// Re-confirming the same directory still replaces a project selection.
			if (nextDirectory === directory.value && selectedProjectId === null) return
			onDirectorySelectionChange(nextDirectory)
			directory.onChange(nextDirectory)
		},
		[directory, onDirectorySelectionChange, selectedProjectId],
	)
	const selectProject = useCallback(
		(projectId: string) => {
			onProjectSelectionChange(projectId)
			setDraftDirectory(null)
			setOpen(false)
		},
		[onProjectSelectionChange],
	)
	const createProject = useCallback(() => {
		setDraftDirectory(null)
		setOpen(false)
		// Let the command dialog finish its close transition before opening the project dialog.
		// Overlapping Radix modal transitions can immediately dismiss the newly opened dialog.
		window.setTimeout(() => onCreateProject?.(), 250)
	}, [onCreateProject])
	const changeOpen = useCallback(
		(nextOpen: boolean) => {
			// Closing without edits keeps a project selection; only typed paths replace it.
			if (!nextOpen && draftDirectory !== null) commitDirectory(draftDirectory)
			if (!nextOpen) setDraftDirectory(null)
			setOpen(nextOpen)
		},
		[commitDirectory, draftDirectory],
	)

	const selectRecent = useCallback(
		(nextDirectory: string) => {
			commitDirectory(nextDirectory)
			setDraftDirectory(null)
			setOpen(false)
		},
		[commitDirectory],
	)
	const confirmDirectory = useCallback(
		(nextDirectory: string) => {
			commitDirectory(nextDirectory)
			setDraftDirectory(null)
			setOpen(false)
		},
		[commitDirectory],
	)
	const pickDirectory = useCallback(async () => {
		try {
			const selected = await pickExistingDirectory()
			if (selected === null) return
			commitDirectory(selected)
			setDraftDirectory(null)
			setOpen(false)
		} catch (error) {
			toast.error('Could not open the folder picker', {
				description: error instanceof Error ? error.message : String(error),
			})
		}
	}, [commitDirectory])

	return (
		<LauncherDirectoryControl
			state={state}
			value={directory.value}
			searchValue={draftDirectory ?? ''}
			selectedProject={selectedProject}
			onCreateProject={onCreateProject ? createProject : undefined}
			open={open}
			disabled={disabled}
			onOpenChange={changeOpen}
			onChange={setDraftDirectory}
			onConfirm={confirmDirectory}
			onBlur={directory.onBlur}
			onPickDirectory={() => void pickDirectory()}
			onSelectRecent={selectRecent}
			onSelectProject={selectProject}
		/>
	)
}
