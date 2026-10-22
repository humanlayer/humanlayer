import type { ReactNode } from 'react'

export type ArtifactActionKey = 'view-mode' | 'search' | 'copy' | 'viewer-version' | 'comments' | 'artifact-actions'

export interface ArtifactActionDescriptor {
	key: ArtifactActionKey
	placement: 'leading' | 'trailing'
	inline: ReactNode
	overflow: ReactNode
}

export interface ArtifactActionTrayProps {
	actions: readonly ArtifactActionDescriptor[]
	overflowOrder: readonly ArtifactActionKey[]
	optionalLeading?: ReactNode
	fixedAction: ReactNode
	size: 'sm' | 'default'
}

export const ARTIFACT_ACTION_OVERFLOW_ORDER: readonly ArtifactActionKey[] = [
	'view-mode',
	'artifact-actions',
	'viewer-version',
	'copy',
	'comments',
	'search',
]
