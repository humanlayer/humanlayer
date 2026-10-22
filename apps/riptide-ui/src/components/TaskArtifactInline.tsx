import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent } from '@humanlayer/ui/components/dialog'
import { cn } from '@humanlayer/ui/lib/utils'
import { Link } from '@tanstack/react-router'
import { Expand, FileText, ImageIcon, ImageOff } from 'lucide-react'
import { memo, use, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SyncContext } from '@/components/providers/SyncContext'
import { SessionDetailContext } from '@/components/session-detail/session-detail-context'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'
import {
	getArtifactDisplayName,
	isImageFileName,
	parseTaskArtifactPath,
	toTaskArtifactReference,
} from '@/lib/task-artifact-path'

interface ArtifactImagePreviewProps {
	url: string
	alt: string
	className?: string
	imageClassName?: string
}

/**
 * Spans only, so the preview can sit inside a markdown paragraph. Top-aligned inline-block,
 * because rows align their icon on the first text baseline and a block image has none.
 */
export const ArtifactImagePreview = memo(function ArtifactImagePreview({
	url,
	alt,
	className,
	imageClassName,
}: ArtifactImagePreviewProps) {
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)

	return (
		<>
			<span className={cn('group relative inline-block max-w-full align-top', className)}>
				<img src={url} alt={alt} title={alt} className={cn('max-w-full rounded align-top', imageClassName)} />
				<span
					className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
					contentEditable={false}
				>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Expand to fullscreen"
						className="h-6 w-6 bg-background/80 hover:bg-background"
						onClick={(e) => {
							e.stopPropagation()
							setIsFullscreenOpen(true)
						}}
						onMouseDown={(e) => e.stopPropagation()}
					>
						<Expand className="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-foreground" />
					</Button>
				</span>
			</span>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
				isActive={isFullscreenOpen}
				rootScopeDisabled={true}
				componentName="ArtifactImagePreview.Fullscreen"
			>
				<Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
					<DialogContent className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-2 !gap-0 overflow-hidden flex items-center justify-center">
						<img src={url} alt={alt} className="max-w-full max-h-full object-contain" />
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
})

const chipClassName =
	'mx-0.5 inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 align-middle font-mono text-[0.875em] font-medium'
const resolvedChipClassName = cn(
	chipClassName,
	'cursor-pointer border-accent bg-accent/10 text-accent hover:bg-accent/20',
)

interface ResolvedArtifact {
	id: string
	task_id: string | null
}

interface ArtifactChipProps {
	path: string
	label: string
	isImage: boolean
	artifact: ResolvedArtifact | undefined
}

function ArtifactChip({ path, label, isImage, artifact }: ArtifactChipProps) {
	const sessionDetail = use(SessionDetailContext)
	const Icon = isImage ? ImageIcon : FileText
	const content = (
		<>
			<Icon className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">{label}</span>
		</>
	)

	if (!artifact?.task_id) {
		return (
			<span
				className={cn(chipClassName, 'border-border text-muted-foreground')}
				title={`Could not find ${path} in the task's artifacts`}
				data-testid="task-artifact-chip"
			>
				{content}
			</span>
		)
	}

	if (sessionDetail && sessionDetail.session.task_id === artifact.task_id) {
		return (
			<button
				type="button"
				className={resolvedChipClassName}
				title={path}
				aria-label={`Open ${label}`}
				data-testid="task-artifact-chip"
				onClick={() => sessionDetail.artifactPanel.handleArtifactClick(artifact.id)}
			>
				{content}
			</button>
		)
	}

	return (
		<Link
			to="/tasks/$taskId"
			params={{ taskId: artifact.task_id }}
			search={{ artifactId: artifact.id }}
			className={resolvedChipClassName}
			title={path}
			aria-label={`Open ${label}`}
			data-testid="task-artifact-chip"
		>
			{content}
		</Link>
	)
}

interface TaskArtifactInlineProps {
	path: string
	alt?: string
}

/** Image artifacts render as a preview; everything else, or an image that is not synced, as a chip. */
export function TaskArtifactInline({ path, alt }: TaskArtifactInlineProps) {
	const reference = toTaskArtifactReference(path)
	const label = getArtifactDisplayName(reference.fileName)
	const isImage = isImageFileName(reference.fileName)
	const { artifact, url } = useTaskArtifactUrl(reference)

	if (isImage && url) {
		return <ArtifactImagePreview url={url} alt={alt || label} imageClassName="max-h-96" />
	}

	return <ArtifactChip path={path} label={label} isImage={isImage} artifact={artifact} />
}

/** Markdown `task-artifact-image` / `task-artifact-mention` elements carry the original path. */
export function TaskArtifactMarkdownElement(props: Record<string, unknown>) {
	const sync = use(SyncContext)
	const path = typeof props.path === 'string' ? props.path : ''
	const alt = typeof props.alt === 'string' ? props.alt : undefined
	if (!parseTaskArtifactPath(path)) return <HostImageChip path={path} />
	if (!sync) return <code>{path}</code>
	return <TaskArtifactInline path={path} alt={alt} />
}

function HostImageChip({ path }: { path: string }) {
	return (
		<span
			className={cn(chipClassName, 'border-border text-muted-foreground')}
			title={`${path} is on the host. Only images in the task's artifacts can be shown here.`}
			data-testid="host-image-chip"
		>
			<ImageOff className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">{getArtifactDisplayName(path)}</span>
		</span>
	)
}
