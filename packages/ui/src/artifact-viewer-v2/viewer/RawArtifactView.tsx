import type { ArtifactSearchCurrentMatch } from '../../markdown-viewer/useArtifactSearch'
import { ArtifactRaw } from '../../components/artifact-raw'
import { cn } from '../../lib/utils'

export interface RawArtifactViewProps {
	content: string
	fileName?: string
	className?: string
	searchQuery?: string
	searchCurrentMatch?: ArtifactSearchCurrentMatch | null
}

/** Read-only current-source view for Artifact Viewer V2. */
export function RawArtifactView({
	content,
	fileName,
	className,
	searchQuery,
	searchCurrentMatch,
}: RawArtifactViewProps) {
	return (
		<ArtifactRaw
			content={content}
			fileName={fileName}
			className={cn('artifact-viewer-v2-raw', className)}
			searchQuery={searchQuery}
			searchCurrentMatch={searchCurrentMatch}
			showCommentBadges={false}
		/>
	)
}
