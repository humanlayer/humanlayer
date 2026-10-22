import type { ReactNode } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export interface ArtifactTargetHotkeyBoundaryProps {
	/**
	 * True while an Artifact Viewer V2 block/range target is live (a pending or
	 * composing review target, or a keyboard-focused block). While active the
	 * dedicated review scope shadows the enclosing artifact scope so the instant
	 * `a`/`d` verdicts own those keys.
	 */
	active: boolean
	children: ReactNode
}

/**
 * Cloud mirror: activates the target-scoped Artifact Viewer V2 review hotkey
 * scope only while a review target is live, over the same shared review-target
 * state. Cloud has no session approval `a`/`d` to collide with, but the scope
 * keeps the target/hotkey adapters symmetric with riptide-ui.
 */
export function ArtifactTargetHotkeyBoundary({ active, children }: ArtifactTargetHotkeyBoundaryProps) {
	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.ARTIFACT_V2_REVIEW}
			isActive={active}
			componentName="ArtifactViewerV2Review"
		>
			{children}
		</HotkeyScopeBoundary>
	)
}
