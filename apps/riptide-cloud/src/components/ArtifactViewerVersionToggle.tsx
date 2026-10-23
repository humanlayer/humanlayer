import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { isMarkdownFile } from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'

import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'

export interface ArtifactViewerVersionToggleProps {
	artifactId: string
	fileName?: string | null
	className?: string
}

export function ArtifactViewerVersionToggle({ artifactId, fileName, className }: ArtifactViewerVersionToggleProps) {
	const forceLegacyViewer = useArtifactViewerStore((state) => !!state.forceLegacyViewerByArtifactId[artifactId])
	const setForceLegacyViewer = useArtifactViewerStore((state) => state.setForceLegacyViewer)

	if (!isMarkdownFile(fileName ?? '')) return null

	const targetVersion = forceLegacyViewer ? 'V2' : 'V1'
	const label = forceLegacyViewer ? 'Use Artifact Viewer V2' : 'Use Artifact Viewer V1 for legacy comments'

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn('h-6 min-w-6 px-1.5 font-mono text-[10px]', className)}
					onClick={() => setForceLegacyViewer(artifactId, !forceLegacyViewer)}
					aria-label={label}
				>
					{targetVersion}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}
