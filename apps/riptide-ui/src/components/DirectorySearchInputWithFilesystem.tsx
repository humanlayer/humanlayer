import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@humanlayer/ui/components/command'
import { FieldError } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Popover, PopoverAnchor, PopoverContent } from '@humanlayer/ui/components/popover'
import { type FuzzyMatch, fuzzySearch, highlightMatches } from '@humanlayer/ui/lib/fuzzy-search'
import { cn } from '@humanlayer/ui/lib/utils'
import { Clock, Folder } from 'lucide-react'
import type React from 'react'
import { useMemo, useReducer, useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { useFilesystemBrowser, validateDirectoryExists } from '@/integrations/desktop/filesystem'

type FilesystemPreviewItem = { name: string; path: string; matches?: FuzzyMatch['matches'] }
type RecentPreviewItem = { path: string; matches?: FuzzyMatch['matches'] }
type ValidationError = { path: string; message: string } | null

interface DirectorySearchState {
	dropdownOpen: boolean
	isFocused: boolean
	recentPreview: RecentPreviewItem[]
	selectedIndex: number
	validationError: ValidationError
}

type DirectorySearchAction =
	| { type: 'focus' }
	| { type: 'blur' }
	| { type: 'closeDropdown' }
	| { type: 'inputChanged'; recentPreview: RecentPreviewItem[]; dropdownOpen: boolean }
	| { type: 'openWithRecent'; recentPreview: RecentPreviewItem[] }
	| { type: 'moveSelection'; selectedIndex: number }
	| { type: 'setValidationError'; validationError: ValidationError }

const initialDirectorySearchState: DirectorySearchState = {
	dropdownOpen: false,
	isFocused: false,
	recentPreview: [],
	selectedIndex: 0,
	validationError: null,
}

function directorySearchReducer(state: DirectorySearchState, action: DirectorySearchAction): DirectorySearchState {
	switch (action.type) {
		case 'focus':
			return { ...state, isFocused: true }
		case 'blur':
			return { ...state, isFocused: false }
		case 'closeDropdown':
			return { ...state, dropdownOpen: false }
		case 'inputChanged':
			return {
				...state,
				dropdownOpen: action.dropdownOpen,
				recentPreview: action.recentPreview,
				selectedIndex: 0,
				validationError: null,
			}
		case 'openWithRecent':
			return { ...state, dropdownOpen: true, recentPreview: action.recentPreview }
		case 'moveSelection':
			return { ...state, selectedIndex: action.selectedIndex }
		case 'setValidationError':
			return { ...state, validationError: action.validationError }
	}
}

function HighlightedInline({
	text,
	matches,
	matchKey,
}: {
	text: string
	matches?: FuzzyMatch['matches']
	matchKey: string
}) {
	const match = matches?.find((m) => m.key === matchKey)
	if (!match) return text
	return highlightMatches(text, match.indices).map((segment, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: segments are positional fragments of one string
		<span key={i} className={cn(segment.highlighted && 'bg-accent/40 font-medium')}>
			{segment.text}
		</span>
	))
}

function RecentDirectoryGroup({
	items,
	selectedIndex,
	onSelect,
}: {
	items: RecentPreviewItem[]
	selectedIndex: number
	onSelect: (path: string) => void
}) {
	if (items.length === 0) return null
	return (
		<CommandGroup heading="Recent Directories">
			{items.map((item, idx) => (
				<CommandItem
					key={`recent-${item.path}`}
					className={cn(
						'cursor-pointer',
						selectedIndex === idx && '!bg-accent/20',
						'data-[selected=true]:!bg-accent/20',
						'[&[data-selected=true]]:text-foreground',
					)}
					onSelect={() => onSelect(item.path)}
				>
					<div className="flex items-center gap-2 w-full">
						<Clock className="w-4 h-4 flex-shrink-0" />
						<span className="flex-1 truncate font-mono text-sm">
							<HighlightedInline text={item.path} matches={item.matches} matchKey="path" />
						</span>
					</div>
				</CommandItem>
			))}
		</CommandGroup>
	)
}

function FilesystemDirectoryGroup({
	items,
	selectedIndex,
	recentCount,
	onSelect,
}: {
	items: FilesystemPreviewItem[]
	selectedIndex: number
	recentCount: number
	onSelect: (path: string) => void
}) {
	if (items.length === 0) return null
	return (
		<CommandGroup heading="Paths">
			{items.map((item, fsIdx) => {
				const itemIndex = recentCount + fsIdx
				return (
					<CommandItem
						key={`fs-${item.path}`}
						className={cn(
							'cursor-pointer',
							selectedIndex === itemIndex && '!bg-accent/20',
							'data-[selected=true]:!bg-accent/20',
							'[&[data-selected=true]]:text-foreground',
						)}
						onSelect={() => onSelect(item.path)}
					>
						<div className="flex items-center gap-2 w-full">
							<Folder className="w-4 h-4 flex-shrink-0" />
							<span className="flex-1 truncate font-mono text-sm">
								<HighlightedInline text={item.name} matches={item.matches} matchKey="name" />
							</span>
						</div>
					</CommandItem>
				)
			})}
		</CommandGroup>
	)
}

function DirectorySearchResults({
	hasResults,
	fsError,
	recentPreview,
	filesystemPreview,
	selectedIndex,
	onSelectRecent,
	onSelectFilesystem,
}: {
	hasResults: boolean
	fsError: string | null
	recentPreview: RecentPreviewItem[]
	filesystemPreview: FilesystemPreviewItem[]
	selectedIndex: number
	onSelectRecent: (path: string) => void
	onSelectFilesystem: (path: string) => void
}) {
	return (
		<Command>
			<CommandList>
				{!hasResults && (
					<CommandEmpty className="py-2 text-sm text-muted-foreground">
						{fsError || 'No matching directories'}
					</CommandEmpty>
				)}
				<RecentDirectoryGroup items={recentPreview} selectedIndex={selectedIndex} onSelect={onSelectRecent} />
				<FilesystemDirectoryGroup
					items={filesystemPreview}
					selectedIndex={selectedIndex}
					recentCount={recentPreview.length}
					onSelect={onSelectFilesystem}
				/>
			</CommandList>
		</Command>
	)
}

interface DirectorySearchInputWithFilesystemProps {
	id?: string
	ref?: React.Ref<HTMLInputElement>
	'aria-label'?: string
	value?: string
	onChange?: (value: string) => void
	onConfirm?: (path: string) => void
	onBlur?: (path: string) => void
	placeholder?: string
	recentDirectories?: string[]
	className?: string
	style?: React.CSSProperties
	disabled?: boolean
	autoFocus?: boolean
}

export function DirectorySearchInputWithFilesystem({
	id,
	ref,
	'aria-label': ariaLabel,
	value = '',
	onChange,
	onConfirm,
	onBlur,
	placeholder = 'where are you writing code today?',
	recentDirectories = [],
	className,
	style,
	disabled = false,
	autoFocus = false,
}: DirectorySearchInputWithFilesystemProps) {
	const [state, dispatch] = useReducer(directorySearchReducer, initialDirectorySearchState)
	const { dropdownOpen, isFocused, recentPreview, selectedIndex, validationError } = state
	const inputRef = useRef<HTMLInputElement>(null)
	const didAutoFocusRef = useRef(false)
	const closeDropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useMountEffect(() => () => {
		if (closeDropdownTimeoutRef.current) clearTimeout(closeDropdownTimeoutRef.current)
	})

	const { directories: filesystemDirs, browse, error: fsError } = useFilesystemBrowser()

	const filesystemPreview = useMemo<FilesystemPreviewItem[]>(() => {
		if (!value || filesystemDirs.length === 0) {
			return []
		}

		// Get the search term (text after last slash)
		const lastSlashIdx = value.lastIndexOf('/')
		const searchTerm = lastSlashIdx === -1 ? value : value.substring(lastSlashIdx + 1)

		if (searchTerm) {
			// Fuzzy search on directory names
			const searchResults = fuzzySearch(
				filesystemDirs.map((d) => ({ name: d.name, path: d.path })),
				searchTerm,
				{
					keys: ['name'],
					threshold: 0.01,
					minMatchCharLength: 1,
					includeMatches: true,
				},
			)

			return searchResults.slice(0, 10).map((result) => ({
				name: result.item.name,
				path: result.item.path,
				matches: result.matches,
			}))
		}

		// Show all directories when no search term (up to 10)
		return filesystemDirs.slice(0, 10).map((d) => ({
			name: d.name,
			path: d.path,
		}))
	}, [filesystemDirs, value])
	const validationMessage = validationError?.path === value ? validationError.message : null

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value
		onChange?.(newValue)
		if (newValue) {
			void browse(newValue)
		}

		// Filter recent directories based on input
		let recentObjs: RecentPreviewItem[] = []

		if (recentDirectories.length > 0) {
			if (newValue) {
				const recentSearchResults = fuzzySearch(
					recentDirectories.map((path) => ({ path })),
					newValue,
					{
						keys: ['path'],
						threshold: 0.3,
						includeMatches: true,
					},
				)

				recentObjs = recentSearchResults.map((result) => ({
					path: result.item.path,
					matches: result.matches,
				}))
			} else {
				recentObjs = recentDirectories.slice(0, 10).map((path) => ({
					path,
				}))
			}
		}

		dispatch({
			type: 'inputChanged',
			recentPreview: recentObjs,
			dropdownOpen: newValue.length > 0 || recentDirectories.length > 0,
		})
	}

	const handleFocus = () => {
		dispatch({ type: 'focus' })
		// Don't open dropdown on focus - only open when user starts typing
		// This allows Tab/Shift-Tab to navigate through the form without triggering autocomplete
	}

	const validateAndNotify = async (pathToValidate: string) => {
		// Validate directory exists
		if (pathToValidate.trim()) {
			const result = await validateDirectoryExists(pathToValidate)
			if (!result.valid) {
				dispatch({
					type: 'setValidationError',
					validationError: { path: pathToValidate, message: result.error ?? 'Directory does not exist' },
				})
			} else {
				dispatch({ type: 'setValidationError', validationError: null })
			}
		} else {
			dispatch({ type: 'setValidationError', validationError: null })
		}

		// Call parent's onBlur callback with the path
		onBlur?.(pathToValidate)
	}

	const handleBlur = async () => {
		dispatch({ type: 'blur' })
		if (closeDropdownTimeoutRef.current) clearTimeout(closeDropdownTimeoutRef.current)
		closeDropdownTimeoutRef.current = setTimeout(() => dispatch({ type: 'closeDropdown' }), 200)

		await validateAndNotify(value)
	}

	const handleSelectRecent = async (path: string) => {
		onChange?.(path)
		void browse(path)
		dispatch({ type: 'setValidationError', validationError: null })
		dispatch({ type: 'closeDropdown' })
		inputRef.current?.focus()

		// Trigger validation when directory is selected
		await validateAndNotify(path)
	}

	const handleSelectFilesystem = async (path: string) => {
		onChange?.(path)
		void browse(path)
		dispatch({ type: 'setValidationError', validationError: null })
		dispatch({ type: 'closeDropdown' })
		inputRef.current?.focus()

		// Trigger validation when directory is selected
		await validateAndNotify(path)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const totalItems = recentPreview.length + filesystemPreview.length

		if (e.key === 'ArrowDown') {
			e.preventDefault()
			// Open dropdown on arrow down if not open
			if (!dropdownOpen && (recentDirectories.length > 0 || value)) {
				dispatch({
					type: 'openWithRecent',
					recentPreview: recentDirectories.slice(0, 10).map((path) => ({ path })),
				})
			}
			if (totalItems > 0) {
				dispatch({ type: 'moveSelection', selectedIndex: (selectedIndex + 1) % totalItems })
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			if (totalItems > 0) {
				dispatch({ type: 'moveSelection', selectedIndex: (selectedIndex - 1 + totalItems) % totalItems })
			}
		} else if (e.key === 'Enter') {
			if (e.metaKey || e.ctrlKey) return
			e.preventDefault()
			e.stopPropagation()
			let confirmedPath = value
			if (dropdownOpen) {
				// Dropdown is open - select item if highlighted, otherwise accept typed value
				if (totalItems > 0 && selectedIndex < totalItems) {
					if (selectedIndex < recentPreview.length) {
						const item = recentPreview[selectedIndex]
						if (item) {
							confirmedPath = item.path
							void handleSelectRecent(item.path)
						}
					} else {
						const fsIndex = selectedIndex - recentPreview.length
						const item = filesystemPreview[fsIndex]
						if (item) {
							confirmedPath = item.path
							void handleSelectFilesystem(item.path)
						}
					}
				}
				dispatch({ type: 'closeDropdown' })
				if (onConfirm) {
					e.currentTarget.blur()
					onConfirm(confirmedPath)
				}
			} else if (onConfirm) {
				// Dropdown is closed and parent wants Enter-to-confirm
				e.currentTarget.blur()
				onConfirm(confirmedPath)
			} else {
				// Dropdown is closed - open it and populate recent directories
				dispatch({
					type: 'openWithRecent',
					recentPreview: recentDirectories.slice(0, 10).map((path) => ({ path })),
				})
			}
		} else if (e.key === 'Escape' && dropdownOpen) {
			// Only capture Escape when dropdown is open - close it and stop propagation
			// to prevent navigation away from the page
			e.preventDefault()
			e.stopPropagation()
			dispatch({ type: 'closeDropdown' })
		} else if (e.key === 'Tab' && dropdownOpen) {
			// Tab completion when dropdown is open
			if (filesystemPreview.length > 0) {
				e.preventDefault()
				// Get the highlighted filesystem item (accounting for recent items offset)
				let fsIndex = selectedIndex - recentPreview.length
				// If selection is in recent section or invalid, default to first filesystem item
				if (fsIndex < 0 || fsIndex >= filesystemPreview.length) {
					fsIndex = 0
				}
				const completionItem = filesystemPreview[fsIndex]
				if (completionItem) {
					onChange?.(completionItem.path)
					void browse(completionItem.path)
					// Reset selection to first item for the new results
					dispatch({ type: 'moveSelection', selectedIndex: recentPreview.length })
				}
			} else {
				// No filesystem suggestions - block Tab to prevent accidental navigation
				// User must Escape to close dropdown first, then Tab to navigate
				e.preventDefault()
			}
		}
		// Tab/Shift-Tab when dropdown is closed are not intercepted - they navigate focus normally
	}

	const hasResults = recentPreview.length > 0 || filesystemPreview.length > 0

	const handleInputRef = (el: HTMLInputElement | null) => {
		inputRef.current = el
		if (typeof ref === 'function') {
			ref(el)
		} else if (ref) {
			ref.current = el
		}
		if (el && autoFocus && !didAutoFocusRef.current) {
			didAutoFocusRef.current = true
			setTimeout(() => el.focus(), 100)
		}
	}

	return (
		<div className="relative" style={style}>
			<Popover open={dropdownOpen && isFocused && hasResults} modal={false}>
				<PopoverAnchor>
					<Input
						id={id}
						ref={handleInputRef}
						aria-label={ariaLabel}
						className={cn('font-mono', className)}
						spellCheck={false}
						onChange={handleChange}
						onKeyDown={handleKeyDown}
						value={value}
						onFocus={handleFocus}
						onBlur={handleBlur}
						placeholder={placeholder}
						disabled={disabled}
						aria-invalid={!!validationMessage}
					/>
				</PopoverAnchor>

				{validationMessage && <FieldError className="mt-1">{validationMessage}</FieldError>}

				<PopoverContent
					onOpenAutoFocus={(e) => e.preventDefault()}
					onMouseDown={(e) => e.preventDefault()}
					side="bottom"
					align="start"
					avoidCollisions={false}
					className="w-[var(--radix-popover-trigger-width)] p-0"
				>
					<DirectorySearchResults
						hasResults={hasResults}
						fsError={fsError}
						recentPreview={recentPreview}
						filesystemPreview={filesystemPreview}
						selectedIndex={selectedIndex}
						onSelectRecent={handleSelectRecent}
						onSelectFilesystem={handleSelectFilesystem}
					/>
				</PopoverContent>
			</Popover>
		</div>
	)
}
