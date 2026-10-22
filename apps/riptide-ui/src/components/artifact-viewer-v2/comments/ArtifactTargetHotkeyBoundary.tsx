import type { ReactNode } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES, type HotkeyScope } from '@/hooks/hotkeys/scopes'

// Stable identity: changing presentation must not cause an effect loop. Both
// hosts are shadowed because sibling effects capture the pre-transition scopes.
const ARTIFACT_HOST_SCOPES = [HOTKEY_SCOPES.ARTIFACT_PANEL, HOTKEY_SCOPES.ARTIFACT_FULLSCREEN] as const

export interface ArtifactTargetHotkeyBoundaryProps {
	/**
	 * True while an Artifact Viewer V2 block/range target is live (a pending or
	 * composing review target, or a keyboard-focused block). While active the
	 * dedicated review scope shadows the enclosing artifact scope so the instant
	 * `a`/`d` verdicts own those keys; clearing the target restores the artifact
	 * scope and hands `a`/`d` back to the session approval shortcuts.
	 */
	active: boolean
	scope: HotkeyScope
	children: ReactNode
}

/**
 * Activates the target-scoped Artifact Viewer V2 review hotkey scope only while
 * a review target is live. It is a thin wrapper over the existing scope-stack
 * boundary — the target-state logic lives in the shared `review-target`
 * module; this component only reflects "is a target active" into scope state.
 */
export function ArtifactTargetHotkeyBoundary({ active, scope, children }: ArtifactTargetHotkeyBoundaryProps) {
	return (
		<HotkeyScopeBoundary
			scope={scope}
			isActive={active}
			shadowScopes={ARTIFACT_HOST_SCOPES}
			componentName={`ArtifactViewerV2Review:${scope}`}
		>
			{children}
		</HotkeyScopeBoundary>
	)
}
