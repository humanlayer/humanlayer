import { useSearch } from '@tanstack/react-router'

import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useMountEffect } from '@/hooks/useMountEffect'

// Reconciles the global, persisted artifact-viewer selection with the current session.
// Mounted with `key={sessionId}` so navigating between sessions remounts it and re-runs
// the mount effect (the session detail page itself is not remounted on param changes).
// Without this, `selectedArtifactId` would stay pointed at the previously viewed
// session's artifact, leaving the "Send & Resolve" button and the artifact sidebar
// showing a stale artifact. When a deep-link artifact is present,
// DeepLinkArtifactApplier owns the selection, so this skips to avoid clobbering it.
// Returns null — it exists purely to host the mount effect.
export function SessionArtifactReconciler() {
	const { artifactPanel } = useSessionDetail()
	const { artifactId: deepLinkArtifactId } = useSearch({ from: '/_app/sessions/$sessionId' })

	useMountEffect(() => {
		if (deepLinkArtifactId) return

		const { savedArtifactId, sidebarTab, setSelectedArtifactId } = artifactPanel

		if (sidebarTab === 'artifacts' && savedArtifactId) {
			// Content restoration is independent from the globally persisted panel size.
			setSelectedArtifactId(savedArtifactId, { claimFocus: false })
			return
		}

		// Clear any artifact selection carried over from the previous session. The saved
		// tab remains unchanged, including an empty Artifacts tab.
		setSelectedArtifactId(null)
	})
	return null
}
