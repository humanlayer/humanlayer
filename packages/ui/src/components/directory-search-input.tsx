import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@humanlayer/ui/components/command'
import { Input } from '@humanlayer/ui/components/input'
import { Popover, PopoverAnchor, PopoverContent } from '@humanlayer/ui/components/popover'
import { Clock } from 'lucide-react'
import type React from 'react'
import { useState, useRef } from 'react'
import { type FuzzyMatch, fuzzySearch, highlightMatches } from '@humanlayer/ui/lib/fuzzy-search'
import { cn } from '@humanlayer/ui/lib/utils'

interface DirectorySearchInputProps {
	value?: string
	onChange?: (value: string) => void
	placeholder?: string
	recentDirectories?: string[]
	className?: string
	disabled?: boolean
}

export function DirectorySearchInput({
	value = '',
	onChange,
	placeholder = 'Select a directory to work in...',
	recentDirectories = [],
	className,
	disabled = false,
}: DirectorySearchInputProps) {
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const [isFocused, setIsFocused] = useState(false)
	const [recentPreview, setRecentPreview] = useState<{ path: string; matches?: FuzzyMatch['matches'] }[]>([])
	const [selectedIndex, setSelectedIndex] = useState<number>(0)
	const inputRef = useRef<HTMLInputElement>(null)

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value
		onChange?.(newValue)
		setDropdownOpen(newValue.length > 0 || recentDirectories.length > 0)
		setSelectedIndex(0) // Reset selection when typing

		// Filter recent directories based on input
		let recentObjs: Array<{ path: string; matches?: FuzzyMatch['matches'] }> = []

		if (recentDirectories.length > 0) {
			if (newValue) {
				// Use fuzzy search on the full path
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
				// Show all recent directories when no search term
				recentObjs = recentDirectories.slice(0, 10).map((path) => ({
					path,
				}))
			}
		}

		setRecentPreview(recentObjs)
	}

	const handleFocus = () => {
		setIsFocused(true)
		// Show dropdown on focus if we have recent directories
		if (recentDirectories.length > 0) {
			setDropdownOpen(true)
			// Initialize recent preview with all directories
			setRecentPreview(
				recentDirectories.slice(0, 10).map((path) => ({
					path,
				})),
			)
		}
	}

	const handleBlur = () => {
		setIsFocused(false)
		// Delay closing to allow click on dropdown items
		setTimeout(() => setDropdownOpen(false), 200)
	}

	const handleSelectDirectory = (path: string) => {
		onChange?.(path)
		setDropdownOpen(false)
		inputRef.current?.focus()
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const totalItems = recentPreview.length

		if (e.key === 'ArrowDown') {
			e.preventDefault()
			if (totalItems > 0) {
				setSelectedIndex((prev) => (prev + 1) % totalItems)
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			if (totalItems > 0) {
				setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems)
			}
		} else if (e.key === 'Enter') {
			e.preventDefault()
			// If dropdown is open and we have items, select the highlighted one
			if (dropdownOpen && totalItems > 0) {
				const selectedItem = recentPreview[selectedIndex]
				if (selectedItem) {
					handleSelectDirectory(selectedItem.path)
				}
			}
		} else if (e.key === 'Escape') {
			e.preventDefault()
			setDropdownOpen(false)
			inputRef.current?.blur()
		}
	}

	return (
		<div className="relative">
			<Popover open={dropdownOpen && isFocused && recentPreview.length > 0} modal={false}>
				<PopoverAnchor>
					<Input
						ref={inputRef}
						className={cn('font-mono', className)}
						spellCheck={false}
						onChange={handleChange}
						onKeyDown={handleKeyDown}
						value={value}
						onFocus={handleFocus}
						onBlur={handleBlur}
						placeholder={placeholder}
						disabled={disabled}
					/>
				</PopoverAnchor>

				<PopoverContent
					onOpenAutoFocus={(e) => e.preventDefault()}
					side="bottom"
					align="start"
					avoidCollisions={false}
					className="w-[var(--radix-popover-trigger-width)] p-0"
				>
					<Command>
						<CommandList>
							{recentPreview.length === 0 && (
								<CommandEmpty className="py-2 text-sm text-muted-foreground">
									No recent directories
								</CommandEmpty>
							)}
							{recentPreview.length > 0 && (
								<CommandGroup heading="Recent Directories">
									{recentPreview.map((item, idx) => {
										const pathMatch = item.matches?.find((m) => m.key === 'path')
										const highlighted = pathMatch
											? highlightMatches(item.path, pathMatch.indices)
											: null

										return (
											<CommandItem
												key={`recent-${idx}`}
												className={cn(
													'cursor-pointer',
													selectedIndex === idx && '!bg-accent/20',
													'data-[selected=true]:!bg-accent/20',
													'[&[data-selected=true]]:text-foreground',
												)}
												onSelect={() => handleSelectDirectory(item.path)}
											>
												<div className="flex items-center space-x-2 w-full">
													<Clock className="w-4 h-4 flex-shrink-0" />
													<span className="flex-1 truncate font-mono text-sm">
														{highlighted
															? highlighted.map((segment, i) => (
																	<span
																		key={i}
																		className={cn(
																			segment.highlighted &&
																				'bg-accent/40 font-medium',
																		)}
																	>
																		{segment.text}
																	</span>
																))
															: item.path}
													</span>
												</div>
											</CommandItem>
										)
									})}
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	)
}
