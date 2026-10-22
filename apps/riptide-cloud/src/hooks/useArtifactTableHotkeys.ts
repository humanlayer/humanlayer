import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import type { TableArtifact } from '@/components/artifact-table/ArtifactTable'

import type { HotkeyScope } from './hotkeys/scopes'

export interface UseArtifactTableHotkeysOptions {
	artifacts: TableArtifact[]
	focusedArtifactId: string | null
	scope: HotkeyScope
	enabled?: boolean

	// Navigation
	onFocusNext: () => void
	onFocusPrevious: () => void

	// Actions
	onActivateArtifact: (artifact: TableArtifact) => void
}

export function useArtifactTableHotkeys({
	artifacts,
	focusedArtifactId,
	scope,
	enabled = true,
	onFocusNext,
	onFocusPrevious,
	onActivateArtifact,
}: UseArtifactTableHotkeysOptions) {
	const focusedArtifact = artifacts.find((a) => a.id === focusedArtifactId) ?? null
	const hasFocus = focusedArtifactId !== null

	// j - Navigate down
	useHotkeys(
		'j',
		() => onFocusNext(),
		{
			scopes: [scope],
			enabled,
		},
		[onFocusNext],
	)

	// k - Navigate up
	useHotkeys(
		'k',
		() => onFocusPrevious(),
		{
			scopes: [scope],
			enabled,
		},
		[onFocusPrevious],
	)

	// enter - Activate focused artifact
	useHotkeys(
		'enter',
		() => {
			if (focusedArtifact) {
				onActivateArtifact(focusedArtifact)
			}
		},
		{
			scopes: [scope],
			enabled: enabled && hasFocus,
		},
		[focusedArtifact, onActivateArtifact],
	)

	return {
		focusedArtifact,
		hasFocus,
	}
}
