import { useNavigate } from '@tanstack/react-router'

import { useMountEffect } from '@/hooks/useMountEffect'

// Mounted with `key={artifactId:commentId:fullscreen}` so changing the deep-link
// target in the URL remounts this and runs onApply once. Returns null — it exists
// purely to host the mount effect. After applying, it consumes the one-shot
// fullscreen flag while leaving the settled artifact selection in the URL.
export function DeepLinkArtifactApplier({
	artifactId,
	commentId,
	fullscreen,
	onApply,
}: {
	artifactId: string
	commentId: string | undefined
	fullscreen?: boolean
	onApply: (artifactId: string, commentId: string | undefined, fullscreen?: boolean) => void
}) {
	const navigate = useNavigate()
	useMountEffect(() => {
		onApply(artifactId, commentId, fullscreen)
		void navigate({
			to: '.',
			search: ((previous: Record<string, unknown>) => ({ ...previous, fullscreen: undefined })) as never,
			replace: true,
			resetScroll: false,
		})
	})
	return null
}
