import { Button } from '@humanlayer/ui/components/button'
import { DropdownMenuItem } from '@humanlayer/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'

import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import type { ArtifactViewerMode } from '@/lib/artifact-viewer-mode'

export interface ArtifactViewerVersionToggleProps {
	artifactId: string
	mode: ArtifactViewerMode
	className?: string
}

export interface ArtifactViewerVersionActionModel {
	targetVersion: 'V1' | 'V2'
	label: string
	toggle: () => void
}

export function useArtifactViewerVersionAction(
	artifactId: string,
	mode: ArtifactViewerMode,
): ArtifactViewerVersionActionModel | null {
	const forceLegacyViewer = useArtifactViewerStore((state) => !!state.forceLegacyViewerByArtifactId[artifactId])
	const setForceLegacyViewer = useArtifactViewerStore((state) => state.setForceLegacyViewer)

	if (!mode.canSwitchVersion) return null

	const targetVersion = forceLegacyViewer ? 'V2' : 'V1'
	const label = forceLegacyViewer ? 'Use Artifact Viewer V2' : 'Use Artifact Viewer V1 for legacy comments'
	return {
		targetVersion,
		label,
		toggle: () => setForceLegacyViewer(artifactId, !forceLegacyViewer),
	}
}

export function ArtifactViewerVersionButton({
	action,
	className,
}: {
	action: ArtifactViewerVersionActionModel
	className?: string
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn('h-6 min-w-6 px-1.5 font-mono text-[10px]', className)}
					onClick={action.toggle}
					aria-label={action.label}
				>
					{action.targetVersion}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{action.label}</TooltipContent>
		</Tooltip>
	)
}

export function ArtifactViewerVersionMenuItem({ action }: { action: ArtifactViewerVersionActionModel }) {
	return <DropdownMenuItem onSelect={action.toggle}>{action.label}</DropdownMenuItem>
}

export function ArtifactViewerVersionToggle({ artifactId, mode, className }: ArtifactViewerVersionToggleProps) {
	const action = useArtifactViewerVersionAction(artifactId, mode)
	return action ? <ArtifactViewerVersionButton action={action} className={className} /> : null
}
