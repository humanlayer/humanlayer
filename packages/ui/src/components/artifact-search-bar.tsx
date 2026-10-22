import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
} from '@humanlayer/ui/components/input-group'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useMountEffect } from '../hooks/use-mount-effect'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { type FC, useRef } from 'react'

export interface ArtifactSearchBarProps {
	query: string
	totalMatches: number
	currentIndex: number
	onQueryChange: (q: string) => void
	onNext: () => void
	onPrev: () => void
	onClose: () => void
	/** Forwarded to the input so the hook can focus/select it on toggle */
	inputRef?: React.RefObject<HTMLInputElement | null>
}

export const ArtifactSearchBar: FC<ArtifactSearchBarProps> = ({
	query,
	totalMatches,
	currentIndex,
	onQueryChange,
	onNext,
	onPrev,
	onClose,
	inputRef,
}) => {
	const localInputRef = useRef<HTMLInputElement | null>(null)
	const setInputRef = (node: HTMLInputElement | null) => {
		localInputRef.current = node
		if (inputRef) {
			inputRef.current = node
		}
	}

	// Capture-phase Escape handler so it only fires when the search input is the
	// document's active element. When the input is blurred, Escape passes through
	// to the surrounding panel (close fullscreen, navigate back, etc.) — same
	// pattern as comment-editor.tsx. onClose comes from useArtifactSearch's
	// useCallback and is stable, so a mount-only listener is safe.
	useMountEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && localInputRef.current === document.activeElement) {
				e.stopImmediatePropagation()
				e.preventDefault()
				onClose()
			}
		}
		document.addEventListener('keydown', handleEscape, { capture: true })
		return () => document.removeEventListener('keydown', handleEscape, { capture: true })
	})

	const navDisabled = totalMatches < 2
	const showCounter = query.length > 0
	const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

	return (
		<InputGroup className="h-8 w-72 max-w-full shadow-sm bg-background">
				<InputGroupAddon align="inline-start" className="shrink-0">
					<Search className="size-4 opacity-50" />
				</InputGroupAddon>
				<InputGroupInput
					ref={setInputRef}
					value={query}
					placeholder="Search in artifact…"
					className="min-w-0"
					onChange={(e) => onQueryChange(e.target.value)}
					onKeyDown={(e) => {
						// Enter is explicitly a no-op (no submit, no navigate, no close)
						if (e.key === 'Enter') e.preventDefault()
					}}
					aria-label="Search in artifact"
				/>
				{showCounter && (
					<InputGroupAddon align="inline-end" className="shrink-0 gap-1">
						<InputGroupText className="text-xs tabular-nums">
							{totalMatches === 0 ? 'No matches' : `${currentIndex + 1}/${totalMatches}`}
						</InputGroupText>
						<span aria-hidden className="ml-1 h-4 w-px bg-border" />
						<Tooltip>
							<TooltipTrigger asChild>
								<InputGroupButton
									size="icon-xs"
									disabled={navDisabled}
									onClick={onPrev}
									aria-label="Previous match"
								>
									<ChevronUp className="size-3.5" />
								</InputGroupButton>
							</TooltipTrigger>
							<TooltipContent>
								<p className="flex items-center gap-1">
									Previous <KeyboardShortcut>{isMac ? '⇧+⌘+g' : 'Shift+Ctrl+g'}</KeyboardShortcut>
								</p>
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<InputGroupButton
									size="icon-xs"
									disabled={navDisabled}
									onClick={onNext}
									aria-label="Next match"
								>
									<ChevronDown className="size-3.5" />
								</InputGroupButton>
							</TooltipTrigger>
							<TooltipContent>
								<p className="flex items-center gap-1">
									Next <KeyboardShortcut>{isMac ? '⌘+g' : 'Ctrl+g'}</KeyboardShortcut>
								</p>
							</TooltipContent>
						</Tooltip>
					</InputGroupAddon>
				)}
				<InputGroupAddon align="inline-end" className="shrink-0">
					<Tooltip>
						<TooltipTrigger asChild>
							<InputGroupButton size="icon-xs" onClick={onClose} aria-label="Close search">
								<X className="size-3.5" />
							</InputGroupButton>
						</TooltipTrigger>
						<TooltipContent>
							<p className="flex items-center gap-1">
								Close search <KeyboardShortcut>Esc</KeyboardShortcut>
							</p>
						</TooltipContent>
					</Tooltip>
			</InputGroupAddon>
		</InputGroup>
	)
}

