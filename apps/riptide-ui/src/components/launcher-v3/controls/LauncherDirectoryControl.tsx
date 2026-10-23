import { Button } from '@humanlayer/ui/components/button'
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import { fuzzySearch } from '@humanlayer/ui/lib/fuzzy-search'
import { ChevronDown, Clock, Folder, FolderGit2, FolderOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useFilesystemBrowser } from '@/integrations/desktop/filesystem'

export interface LauncherDirectoryProjectOption {
	id: string
	name: string
	repositoryCount: number
}

export type LauncherDirectoryControlState =
	| { status: 'host-required' }
	| {
			status: 'ready'
			useFilesystem: boolean
			recentDirectories: readonly string[]
			projects: readonly LauncherDirectoryProjectOption[]
	  }

export interface LauncherDirectoryControlProps {
	state: LauncherDirectoryControlState
	value: string
	searchValue: string
	selectedProject: LauncherDirectoryProjectOption | null
	open: boolean
	disabled?: boolean
	onOpenChange: (open: boolean) => void
	onChange: (value: string) => void
	onConfirm: (value: string) => void
	onBlur: () => void
	onPickDirectory: () => void
	onSelectRecent: (value: string) => void
	onSelectProject: (projectId: string) => void
	onCreateProject?: () => void
}

function splitDirectoryDisplay(path: string): { prefix: string; basename: string } {
	const trimmed = path.trim().replace(/[\\/]+$/, '')
	if (!trimmed) return { prefix: '', basename: '' }
	const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
	if (separator < 0) return { prefix: '', basename: trimmed }
	return { prefix: trimmed.slice(0, separator + 1), basename: trimmed.slice(separator + 1) }
}

const PALETTE_ITEM_STYLES = [
	'[&_[data-slot=command-item]]:rounded-none',
	'[&_[data-slot=command-item]]:border-l-2',
	'[&_[data-slot=command-item]]:border-l-transparent',
	'[&_[data-slot=command-item][data-selected=true]]:border-l-[var(--terminal-accent)]',
	'[&_[data-slot=command-item][data-selected=true]]:bg-accent/10',
	'[&_[data-slot=command-item][data-selected=true]]:text-foreground',
	"[&_[data-slot=command-item][data-selected=true]_svg:not([class*='text-'])]:text-muted-foreground",
].join(' ')

interface FilesystemPreviewItem {
	name: string
	path: string
}

function useFilteredProjects(
	projects: readonly LauncherDirectoryProjectOption[],
	searchValue: string,
): readonly LauncherDirectoryProjectOption[] {
	return useMemo(() => {
		if (projects.length === 0) return projects
		if (!searchValue.trim()) return projects
		if (searchValue.startsWith('/') || searchValue.startsWith('~') || searchValue.startsWith('.')) return projects
		const results = fuzzySearch(
			projects.map((p) => ({ ...p })),
			searchValue,
			{ keys: ['name'], threshold: 0.3 },
		)
		return results.map((r) => r.item)
	}, [projects, searchValue])
}

function useFilteredRecents(recentDirectories: readonly string[], searchValue: string): readonly string[] {
	return useMemo(() => {
		if (recentDirectories.length === 0) return recentDirectories
		if (!searchValue.trim()) return recentDirectories
		const results = fuzzySearch(
			recentDirectories.map((path) => ({ path })),
			searchValue,
			{ keys: ['path'], threshold: 0.3 },
		)
		return results.map((r) => r.item.path)
	}, [recentDirectories, searchValue])
}

function useFilesystemPreview(
	enabled: boolean,
	searchValue: string,
): { preview: readonly FilesystemPreviewItem[]; firstPath: string | null } {
	const { directories, browse } = useFilesystemBrowser()
	const lastBrowsedRef = useRef('')

	useEffect(() => {
		if (!enabled || !searchValue) return
		const lastSlashIdx = searchValue.lastIndexOf('/')
		const basePath = lastSlashIdx === -1 ? '' : searchValue.substring(0, lastSlashIdx + 1)
		if (basePath && basePath !== lastBrowsedRef.current) {
			lastBrowsedRef.current = basePath
			void browse(searchValue)
		}
	}, [enabled, searchValue, browse])

	const preview = useMemo<readonly FilesystemPreviewItem[]>(() => {
		if (!enabled || !searchValue || directories.length === 0) return []

		const lastSlashIdx = searchValue.lastIndexOf('/')
		const searchTerm = lastSlashIdx === -1 ? searchValue : searchValue.substring(lastSlashIdx + 1)

		if (searchTerm) {
			const results = fuzzySearch(
				directories.map((d) => ({ name: d.name, path: d.path })),
				searchTerm,
				{ keys: ['name'], threshold: 0.01, minMatchCharLength: 1 },
			)
			return results.slice(0, 10).map((r) => ({ name: r.item.name, path: r.item.path }))
		}

		return directories.slice(0, 10).map((d) => ({ name: d.name, path: d.path }))
	}, [enabled, directories, searchValue])

	return { preview, firstPath: preview[0]?.path ?? null }
}

export function LauncherDirectoryControl({
	state,
	value,
	searchValue,
	selectedProject,
	open,
	disabled = false,
	onOpenChange,
	onChange,
	onConfirm,
	onBlur,
	onPickDirectory,
	onSelectRecent,
	onSelectProject,
	onCreateProject,
}: LauncherDirectoryControlProps) {
	const display = splitDirectoryDisplay(value)
	const projects = state.status === 'ready' ? state.projects : []
	const recentDirectories = state.status === 'ready' ? state.recentDirectories : []
	const useFilesystem = state.status === 'ready' && state.useFilesystem
	const canCreateProject = state.status === 'ready' && state.useFilesystem && onCreateProject !== undefined

	const filteredProjects = useFilteredProjects(projects, searchValue)
	const filteredRecents = useFilteredRecents(recentDirectories, searchValue)
	const { preview: filesystemPreview, firstPath: firstFsPath } = useFilesystemPreview(useFilesystem, searchValue)

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen)
			if (!nextOpen) onBlur()
		},
		[onOpenChange, onBlur],
	)

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Tab' && firstFsPath) {
				event.preventDefault()
				onChange(firstFsPath)
			}
		},
		[firstFsPath, onChange],
	)

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				aria-label="Working directory"
				title={selectedProject ? `Project: ${selectedProject.name}` : value.trim() || 'Choose directory'}
				disabled={disabled}
				onClick={() => onOpenChange(true)}
				className="h-7 min-w-0 max-w-full gap-1.5 px-2 text-xs normal-case tracking-tight text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent"
			>
				{selectedProject ? (
					<FolderGit2 aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-accent)]" />
				) : (
					<FolderOpen aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-accent)]" />
				)}
				<span className="flex min-w-0 items-center">
					{selectedProject ? (
						<span className="truncate group-data-[density=minimal]/tray:hidden">
							{selectedProject.name}
						</span>
					) : (
						<>
							{display.prefix && (
								<span className="truncate font-normal group-data-[density=compact]/tray:hidden group-data-[density=minimal]/tray:hidden">
									{display.prefix}
								</span>
							)}
							<span className="truncate group-data-[density=minimal]/tray:hidden">
								{display.basename ||
									(projects.length > 0 ? 'Choose project or directory' : 'Choose directory')}
							</span>
						</>
					)}
				</span>
				<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
			</Button>
			<CommandDialog
				open={open}
				onOpenChange={handleOpenChange}
				title="Choose project or directory"
				description="Search projects or type a directory path"
				showCloseButton={false}
				shouldFilter={false}
				className={`sm:max-w-xl top-[15%] translate-y-0 border-0 [&_[cmdk-item]]:py-1.5 [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:bg-accent/5 ${PALETTE_ITEM_STYLES}`}
			>
				<CommandInput
					placeholder={projects.length > 0 ? 'Search projects or type a path...' : 'Type a directory path...'}
					value={searchValue}
					onValueChange={onChange}
					onKeyDown={handleKeyDown}
					disabled={disabled}
				/>
				<CommandList className="max-h-[min(60vh,36rem)]">
					{state.status === 'host-required' ? (
						<CommandEmpty>Connect a host to choose a working directory.</CommandEmpty>
					) : (
						<>
							<CommandEmpty>No matching projects or directories</CommandEmpty>

							{!useFilesystem && searchValue.trim() && (
								<CommandGroup>
									<CommandItem
										value="use-typed-directory"
										onSelect={() => onConfirm(searchValue.trim())}
										className="flex items-center gap-2 px-4 py-1.5"
										disabled={disabled}
									>
										<Folder aria-hidden className="size-4 shrink-0" />
										<span className="truncate">Use directory {searchValue.trim()}</span>
									</CommandItem>
								</CommandGroup>
							)}

							{filteredProjects.length > 0 && (
								<CommandGroup heading="Projects">
									{filteredProjects.map((project) => (
										<CommandItem
											key={project.id}
											onSelect={() => onSelectProject(project.id)}
											className="flex items-center gap-2 px-4 py-1.5"
											disabled={disabled}
										>
											<FolderGit2
												aria-hidden
												className="size-4 shrink-0 text-[var(--terminal-accent)]"
											/>
											<span className="truncate">{project.name}</span>
											<span className="ml-auto shrink-0 text-xs text-muted-foreground">
												{project.repositoryCount}{' '}
												{project.repositoryCount === 1 ? 'repo' : 'repos'}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							)}

							{canCreateProject && (
								<CommandGroup>
									<CommandItem
										value="create-new-project"
										onSelect={onCreateProject}
										className="flex items-center gap-2 px-4 py-1.5"
										disabled={disabled}
									>
										<Plus aria-hidden className="size-4 shrink-0 text-[var(--terminal-accent)]" />
										<span>Create new project</span>
									</CommandItem>
								</CommandGroup>
							)}

							{useFilesystem && (
								<CommandGroup>
									<CommandItem
										onSelect={onPickDirectory}
										className="flex items-center gap-2 px-4 py-1.5"
										disabled={disabled}
									>
										<FolderOpen
											aria-hidden
											className="size-4 shrink-0 text-[var(--terminal-accent)]"
										/>
										<span>Open directory picker</span>
									</CommandItem>
								</CommandGroup>
							)}

							{filesystemPreview.length > 0 && (
								<CommandGroup heading="Paths">
									{filesystemPreview.map((item) => (
										<CommandItem
											key={item.path}
											onSelect={() => onConfirm(item.path)}
											className="flex items-center gap-2 px-4 py-1.5"
											disabled={disabled}
										>
											<Folder aria-hidden className="size-4 shrink-0" />
											<span className="truncate font-mono text-xs">{item.name}</span>
										</CommandItem>
									))}
								</CommandGroup>
							)}

							{filteredRecents.length > 0 && (
								<CommandGroup heading="Recent">
									{filteredRecents.map((directory) => (
										<CommandItem
											key={directory}
											onSelect={() => onSelectRecent(directory)}
											className="flex items-center gap-2 px-4 py-1.5"
											disabled={disabled}
										>
											<Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate font-mono text-xs">{directory}</span>
										</CommandItem>
									))}
								</CommandGroup>
							)}
						</>
					)}
				</CommandList>
				<div className="flex gap-4 border-t bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
					<span>↑↓ navigate</span>
					{useFilesystem && <span>Tab complete</span>}
					<span>↵ select</span>
					<span>Esc close</span>
				</div>
			</CommandDialog>
		</>
	)
}
