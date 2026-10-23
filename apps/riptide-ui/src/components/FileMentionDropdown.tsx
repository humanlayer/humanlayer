import { fuzzySearch, highlightMatches } from '@humanlayer/ui/lib/fuzzy-search'
import { cn } from '@humanlayer/ui/lib/utils'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'
import { FileIcon, FileText, FolderIcon, Loader2 } from 'lucide-react'
import { type Ref, useCallback, useImperativeHandle, useRef, useState } from 'react'

import { type TaskArtifact, useTaskArtifacts } from '@/hooks/live-queries/useTaskArtifacts'
import { type FileMatch, fuzzySearchFiles, isPathLikeQuery, searchPathQuery } from '@/integrations/desktop/filesystem'

// A fuzzy search ranks by score, so the best matches come first and a short
// list is enough. A listing has no such order: it is directories first, then
// alphabetical. A short list there would show only directories in a folder that
// holds many, hiding every file behind a cut the user cannot rank around.
const FUZZY_RESULT_LIMIT = 20
const PATH_RESULT_LIMIT = 100

interface FileMentionDropdownProps {
	query: string
	command: (item: { id: string; label: string; isDirectory: boolean; isArtifact: boolean }) => void
	taskId: string | null
	/** Absolute working directory path for file search */
	workingDirectory?: string | null
	/** When true, hide the Files section (no filesystem access) */
	isHostOffline?: boolean
	/** When true, file search is not available (remote host) */
	isRemoteHost?: boolean
	/**
	 * Replaces the mention being typed and keeps the dropdown open. Used to
	 * descend into a directory chosen from a typed path.
	 */
	continueQuery?: (text: string) => void
	/** Imperative handle ref — a normal prop in React 19 (no forwardRef needed). */
	ref?: Ref<FileMentionDropdownRef>
}

export interface FileMentionDropdownRef {
	onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const FileMentionDropdown = ({
	query,
	command,
	taskId,
	workingDirectory,
	isHostOffline,
	isRemoteHost,
	continueQuery,
	ref,
}: FileMentionDropdownProps) => {
	// Co-locate the navigation index with the query it belongs to.
	// When query changes, selectedIndex automatically derives as 0 — no effect or
	// render-time setState mutation needed.
	const [navState, setNavState] = useState<{ query: string; index: number }>({ query, index: 0 })
	const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

	// Fetch artifacts for the task
	const artifacts = useTaskArtifacts(taskId ?? '')

	// Fuzzy filter artifacts by query
	const filteredArtifacts =
		query && artifacts.length > 0
			? fuzzySearch(artifacts, query, {
					keys: ['file_name'],
					threshold: 0.01,
					minMatchCharLength: 1,
				})
			: artifacts.map((a) => ({
					score: 1,
					indices: [],
					item: a,
					matches: [],
				}))

	// Debounce file search query to avoid re-running on every keystroke
	const debouncedQuery = useDebounce(query, 150)

	// File search (Tauri/Rust command) via TanStack Query — a read operation, so useQuery
	// is the right tool (no-use-effect Rule 2). It handles caching, in-flight tracking, and
	// stale-response cancellation (changing the queryKey discards superseded results), and
	// gives us data/isFetching/isError/error for free.
	// An absolute or `~` path query lists a directory on the host instead of
	// fuzzy-searching the working directory, so files outside the worktree stay
	// reachable. Both modes need a host that can read files.
	const canSearchFiles = !isHostOffline && !isRemoteHost
	const isPathQuery = isPathLikeQuery(debouncedQuery)
	// The live query decides what the section shows; the debounced one decides
	// what is fetched. Tracking both keeps the section from unmounting during the
	// debounce window when the leading `/` is typed or deleted.
	const isPathQueryPending = isPathLikeQuery(query)
	const showFilesSection = canSearchFiles && (!!workingDirectory || isPathQuery || isPathQueryPending)
	const fileSearchEnabled = canSearchFiles && !!debouncedQuery && (isPathQuery || !!workingDirectory)
	const { data: fileSearchData, isFetching } = useQuery({
		// A path query reads no working directory, so it must not be keyed by one:
		// the same typed path would otherwise be cached once per session.
		queryKey: isPathQuery
			? ['listPathQuery', debouncedQuery]
			: ['fuzzySearchFiles', workingDirectory, debouncedQuery],
		queryFn: () =>
			isPathQuery
				? searchPathQuery(debouncedQuery, PATH_RESULT_LIMIT + 1)
				: fuzzySearchFiles(debouncedQuery, [workingDirectory ?? ''], FUZZY_RESULT_LIMIT),
		enabled: fileSearchEnabled,
		// Keep showing the previous results while the next query is in-flight.
		placeholderData: keepPreviousData,
	})
	// Clear results entirely when search is disabled (offline/remote/empty query) so stale
	// placeholder data never leaks through.
	const allFileResults = fileSearchEnabled ? (fileSearchData ?? []) : []
	// One extra row was fetched purely to detect a cut. Drop it, and tell the
	// user the list is short rather than letting an entry vanish in silence.
	const isListingTruncated = isPathQuery && allFileResults.length > PATH_RESULT_LIMIT
	const fileResults = isListingTruncated ? allFileResults.slice(0, PATH_RESULT_LIMIT) : allFileResults

	// Derive the total result count and the selected index in one place.
	// When query changes, navState.query !== query so selectedIndex derives as 0.
	// Clamp to valid range so a stale index after results change is never out of bounds.
	const totalResults = filteredArtifacts.length + fileResults.length
	const selectedIndex =
		totalResults > 0 ? Math.min(navState.query === query ? navState.index : 0, totalResults - 1) : 0

	// Derive loading: show spinner while the debounce hasn't fired yet OR while a
	// fetch is in-flight. isFetching comes straight from useQuery.
	const isFileSearchLoading =
		(fileSearchEnabled && isFetching) || (showFilesSection && !!query && query !== debouncedQuery)

	const handleSelect = useCallback(
		(artifact: TaskArtifact) => {
			const path = `.humanlayer/tasks/${artifact.task_slug}/${artifact.file_name}`
			command({
				id: `@${path}`,
				label: artifact.file_name,
				isDirectory: false,
				isArtifact: true,
			})
		},
		[command],
	)

	const handleFileSelect = useCallback(
		(file: FileMatch) => {
			// Choosing a directory while typing a path descends into it rather than
			// mentioning it, which is what lets a listing reach a name the mention
			// itself could never contain, such as one with spaces.
			if (isPathQuery && file.is_directory && continueQuery) {
				continueQuery(`${file.path}/`)
				return
			}
			command({
				id: `@${file.path}`,
				label: file.display_path,
				isDirectory: file.is_directory,
				isArtifact: false,
			})
		},
		[command, continueQuery, isPathQuery],
	)

	const onKeyDown = useCallback(
		({ event }: { event: KeyboardEvent }) => {
			if (totalResults === 0) return false

			if (event.key === 'ArrowUp') {
				event.preventDefault()
				const newIndex = (selectedIndex - 1 + totalResults) % totalResults
				setNavState({ query, index: newIndex })
				buttonRefs.current[newIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
				return true
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault()
				const newIndex = (selectedIndex + 1) % totalResults
				setNavState({ query, index: newIndex })
				buttonRefs.current[newIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
				return true
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				const artifactCount = filteredArtifacts.length
				if (selectedIndex < artifactCount) {
					const selected = filteredArtifacts[selectedIndex]
					if (selected) handleSelect(selected.item as TaskArtifact)
				} else {
					const fileIdx = selectedIndex - artifactCount
					const file = fileResults[fileIdx]
					if (file) handleFileSelect(file)
				}
				return true
			}
			return false
		},
		[totalResults, selectedIndex, query, filteredArtifacts, fileResults, handleSelect, handleFileSelect],
	)

	useImperativeHandle(ref, () => ({ onKeyDown }))

	if (totalResults === 0 && !taskId && !showFilesSection) {
		return <div className="px-3 py-2 text-sm text-muted-foreground">No task selected: artifacts unavailable</div>
	}

	if (totalResults === 0 && !isFileSearchLoading) {
		return <div className="px-3 py-2 text-sm text-muted-foreground">No matches found</div>
	}

	return (
		<div className="max-h-[360px] overflow-y-auto flex flex-col">
			{/* Artifacts Section */}
			{filteredArtifacts.length > 0 && (
				<>
					<div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Artifacts
					</div>
					{filteredArtifacts.map((match, index) => {
						const artifact = match.item as TaskArtifact
						const nameIndices = match.matches.find((m) => m.key === 'file_name')?.indices ?? []
						const highlighted =
							nameIndices.length > 0 ? highlightMatches(artifact.file_name, nameIndices) : null

						return (
							<button
								key={artifact.id}
								ref={(el) => {
									buttonRefs.current[index] = el
								}}
								type="button"
								className={cn(
									'group w-full flex items-center gap-2 px-2 py-1 text-sm text-left hover:bg-accent hover:text-background',
									index === selectedIndex && 'bg-accent text-background',
								)}
								onMouseEnter={() => setNavState({ query, index })}
								onClick={() => handleSelect(artifact)}
							>
								<FileText
									className={cn(
										'h-4 w-4 flex-shrink-0 text-[var(--terminal-accent)] group-hover:text-background',
										index === selectedIndex && 'text-background',
									)}
								/>
								<span className="truncate">
									{highlighted
										? highlighted.map((seg, i) => (
												<span
													key={i}
													className={cn(seg.highlighted && 'bg-accent/40 font-medium')}
												>
													{seg.text}
												</span>
											))
										: artifact.file_name}
								</span>
							</button>
						)
					})}
				</>
			)}

			{/* Files Section */}
			{showFilesSection && (
				<>
					<div
						className={cn(
							'px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider',
							filteredArtifacts.length > 0 && 'border-t border-border mt-1 pt-1',
						)}
					>
						Files
					</div>
					{isFileSearchLoading && (
						<div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
							<Loader2 className="h-3 w-3 animate-spin" />
							Searching…
						</div>
					)}
					{!isFileSearchLoading && fileResults.length === 0 && query && (
						<div className="px-3 py-1.5 text-sm text-muted-foreground">No files found</div>
					)}
					{fileResults.map((file, fileIdx) => {
						const index = filteredArtifacts.length + fileIdx
						const basename = file.path.split('/').pop() ?? file.path
						const basenameIndices = file.matched_indexes
							.filter((i) => i >= file.path.length - basename.length)
							.map((i) => i - (file.path.length - basename.length))
						const highlighted =
							basenameIndices.length > 0 ? highlightMatches(basename, basenameIndices) : null

						return (
							<button
								key={file.path}
								ref={(el) => {
									buttonRefs.current[index] = el
								}}
								type="button"
								className={cn(
									'group w-full flex items-center gap-2 px-2 py-1 text-sm text-left hover:bg-accent hover:text-background',
									index === selectedIndex && 'bg-accent text-background',
								)}
								onMouseEnter={() => setNavState({ query, index })}
								onClick={() => handleFileSelect(file)}
							>
								{file.is_directory ? (
									<FolderIcon
										className={cn(
											'h-4 w-4 flex-shrink-0 text-[var(--terminal-accent)] group-hover:text-background',
											index === selectedIndex && 'text-background',
										)}
									/>
								) : (
									<FileIcon
										className={cn(
											'h-4 w-4 flex-shrink-0 text-[var(--terminal-accent)] group-hover:text-background',
											index === selectedIndex && 'text-background',
										)}
									/>
								)}
								<span className="truncate">
									{highlighted ? (
										<>
											{file.display_path.substring(0, file.display_path.length - basename.length)}
											{highlighted.map((seg, i) => (
												<span
													key={i}
													className={cn(seg.highlighted && 'bg-accent/40 font-medium')}
												>
													{seg.text}
												</span>
											))}
										</>
									) : (
										file.display_path
									)}
								</span>
							</button>
						)
					})}
					{isListingTruncated && (
						<div className="px-3 py-1.5 text-xs text-muted-foreground italic">
							More entries than shown. Type more of the name to narrow the list.
						</div>
					)}
				</>
			)}

			{/* Remote host message */}
			{isRemoteHost && !isHostOffline && (
				<div
					className={cn(
						'px-3 py-1.5 text-xs text-muted-foreground italic',
						filteredArtifacts.length > 0 && 'border-t border-border mt-1 pt-1',
					)}
				>
					File search is not available for remote hosts
				</div>
			)}

			{/* Host offline message */}
			{isHostOffline && (
				<div
					className={cn(
						'px-3 py-1.5 text-xs text-muted-foreground italic',
						filteredArtifacts.length > 0 && 'border-t border-border mt-1 pt-1',
					)}
				>
					Host offline: file search unavailable
				</div>
			)}
		</div>
	)
}
