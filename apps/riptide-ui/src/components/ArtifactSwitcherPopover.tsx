import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES, type HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { getArtifactIconNode } from '@/utils/artifact-icon'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

import { ArtifactsListPure } from './ArtifactsListPure'

export interface ArtifactSwitcherPopoverProps {
	artifacts: SessionArtifact[]
	selectedArtifactId: string | null
	onArtifactSelect: (id: string) => void
	/** Map of artifact id → count of open unresolved comments, shown next to each row. */
	commentCounts: Record<string, number>
	/**
	 * Host-surface hotkey scopes where ⇧A opens this instance. Every host must
	 * name its own scopes — the sidebar passes the page scopes plus
	 * ARTIFACT_PANEL, the fullscreen panel passes only its own scope so the
	 * sidebar instance still mounted behind the overlay does not also toggle.
	 */
	toggleHotkeyScopes: HotkeyScope[]
}

export function ArtifactSwitcherPopover({
	artifacts,
	selectedArtifactId,
	onArtifactSelect,
	commentCounts,
	toggleHotkeyScopes,
}: ArtifactSwitcherPopoverProps) {
	const [open, setOpen] = useState(false)
	const selected = artifacts.find((a) => a.id === selectedArtifactId)
	const selectedName = selected?.path.split('/').pop() ?? 'Artifacts'
	const triggerIcon = getArtifactIconNode(
		{
			fileName: selected?.path.split('/').pop() ?? '',
			category: selected?.categories?.[0],
			storageType: selected?.storageType,
		},
		'h-3 w-3',
	)

	// While open, this instance owns the shared ARTIFACT_SWITCHER scope, and
	// only then does it listen there. Multiple switchers can be mounted at once
	// (sidebar viewer + fullscreen overlay); registering a closed instance in
	// the shared scope would make another instance's open popover drive it too.
	useAppHotkeys(
		'shift+a',
		() => setOpen((prev) => !prev),
		{
			scopes: open ? [HOTKEY_SCOPES.ARTIFACT_SWITCHER] : toggleHotkeyScopes,
			area: 'RIGHT_PANE',
			preventDefault: true,
		},
		[open, toggleHotkeyScopes],
	)

	useHotkeys(
		'Escape',
		() => setOpen(false),
		{
			scopes: [HOTKEY_SCOPES.ARTIFACT_SWITCHER],
			enabled: open,
			preventDefault: true,
		},
		[open],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.ARTIFACT_SWITCHER}
			isActive={open}
			componentName="ArtifactSwitcherPopover"
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="flex h-7 max-w-[280px] cursor-pointer items-center gap-1.5 rounded-none border border-[var(--terminal-accent)]/40 bg-transparent px-2 text-xs text-[var(--terminal-fg)] transition-colors hover:border-[var(--terminal-accent)]/70 hover:bg-[var(--terminal-accent)]/10 active:opacity-80"
					>
						{triggerIcon}
						<span className="truncate max-w-[180px]">{selectedName}</span>
						<KeyboardShortcut size="xs">⇧+A</KeyboardShortcut>
						<ChevronDown className="h-3 w-3" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" sideOffset={8} className="p-2 w-80 max-h-96 overflow-y-auto">
					<ArtifactsListPure
						artifacts={artifacts}
						onArtifactClick={(id) => {
							onArtifactSelect(id)
							setOpen(false)
						}}
						commentCounts={commentCounts}
					/>
				</PopoverContent>
			</Popover>
		</HotkeyScopeBoundary>
	)
}
