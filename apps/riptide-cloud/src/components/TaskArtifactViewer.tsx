import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent } from '@humanlayer/ui/components/dialog'
import { cn } from '@humanlayer/ui/lib/utils'
import { useParams } from '@tanstack/react-router'
import { Expand, Loader2 } from 'lucide-react'
import { memo, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArtifactRouteTaskId } from '@/hooks/useArtifactRouteTaskId'
import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'

export interface TaskArtifactViewerProps {
	/** File path to the artifact. Can be passed as `code` (from TipTap) or `filePath`. */
	code?: string
	filePath?: string
	className?: string
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'])

function isImageFile(fileName: string): boolean {
	const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
	return IMAGE_EXTENSIONS.has(ext)
}

function extractFileName(filePath: string): string {
	const trimmed = filePath.trim()
	const taskPathMatch = trimmed.match(/\.humanlayer\/tasks\/[^/]+\/(.+)$/)
	if (taskPathMatch) {
		const [, captured] = taskPathMatch
		if (captured !== undefined) {
			return captured
		}
	}
	return trimmed
}

function ArtifactLoading({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-center justify-center gap-2 bg-muted/50 rounded p-4 min-h-[100px]', className)}>
			<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			<span className="text-sm text-muted-foreground">Loading artifact...</span>
		</div>
	)
}

function ArtifactError({ filePath, message, className }: { filePath: string; message: string; className?: string }) {
	return (
		<div className={cn('text-xs font-mono bg-muted/50 rounded p-2 overflow-auto', className)}>
			<pre className="whitespace-pre-wrap text-muted-foreground">{filePath}</pre>
			<div
				className="text-[10px] text-muted-foreground/60 italic"
				style={{ marginTop: '8px', marginBottom: '8px', marginLeft: '12px' }}
			>
				{message}
			</div>
		</div>
	)
}

interface ArtifactImageProps {
	url: string
	fileName: string
	className?: string
	isFullscreenOpen: boolean
	onFullscreenChange: (open: boolean) => void
}

const ArtifactImage = memo(function ArtifactImage({
	url,
	fileName,
	className,
	isFullscreenOpen,
	onFullscreenChange,
}: ArtifactImageProps) {
	return (
		<>
			<div className={cn('relative overflow-hidden group', className)}>
				<img src={url} alt={fileName} className="max-w-full rounded" />
				<div
					className="absolute right-2 top-8 opacity-0 group-hover:opacity-100 transition-opacity"
					contentEditable={false}
				>
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 bg-background/80 hover:bg-background"
						onClick={(e) => {
							e.stopPropagation()
							onFullscreenChange(true)
						}}
						onMouseDown={(e) => e.stopPropagation()}
					>
						<Expand className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
					</Button>
				</div>
			</div>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
				isActive={isFullscreenOpen}
				rootScopeDisabled={true}
				componentName="TaskArtifactViewer.ImageFullscreen"
			>
				<Dialog open={isFullscreenOpen} onOpenChange={onFullscreenChange}>
					<DialogContent className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-2 !gap-0 overflow-hidden flex items-center justify-center">
						<img src={url} alt={fileName} className="max-w-full max-h-full object-contain" />
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
})

interface ArtifactIframeProps {
	url: string
	fileName: string
	iframeRenderKey?: string
	className?: string
	isFullscreenOpen: boolean
	onFullscreenChange: (open: boolean) => void
}

const ArtifactIframe = memo(function ArtifactIframe({
	url,
	fileName,
	iframeRenderKey,
	className,
	isFullscreenOpen,
	onFullscreenChange,
}: ArtifactIframeProps) {
	return (
		<>
			<div className={cn('relative border border-border overflow-hidden', className)}>
				<iframe
					key={iframeRenderKey}
					src={url}
					title={fileName}
					className="w-full h-[300px] border-0"
					sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
				/>
				<div className="absolute right-2 top-8" contentEditable={false}>
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 bg-background/80 hover:bg-background"
						onClick={(e) => {
							e.stopPropagation()
							onFullscreenChange(true)
						}}
						onMouseDown={(e) => e.stopPropagation()}
					>
						<Expand className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
					</Button>
				</div>
			</div>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
				isActive={isFullscreenOpen}
				rootScopeDisabled={true}
				componentName="TaskArtifactViewer.IframeFullscreen"
			>
				<Dialog open={isFullscreenOpen} onOpenChange={onFullscreenChange}>
					<DialogContent className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-2 !gap-0 overflow-hidden">
						<iframe
							key={iframeRenderKey}
							src={url}
							title={fileName}
							className="w-full h-full border-0"
							sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
							tabIndex={-1}
						/>
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
})

/**
 * TaskArtifactViewer for riptide-cloud.
 * Renders HTML and image artifacts in a sandboxed iframe.
 * Only supports /artifacts/:artifactId routes.
 */
export function TaskArtifactViewer({ code, filePath: filePathProp, className }: TaskArtifactViewerProps) {
	const filePath = code ?? filePathProp ?? ''
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)

	const params = useParams({ strict: false })
	const artifactId = 'artifactId' in params ? (params.artifactId as string) : undefined

	const fileName = extractFileName(filePath)
	const isImage = isImageFile(fileName)

	const { taskId, isLoading: isTaskIdLoading } = useArtifactRouteTaskId()
	const {
		artifact,
		url: artifactUrl,
		isLoading: isUrlLoading,
		error: urlError,
	} = useTaskArtifactUrl(taskId, fileName)

	const hasArtifactId = !!artifactId

	if (urlError) {
		return <ArtifactError filePath={filePath} message={urlError.message} className={className} />
	}

	if (isUrlLoading || isTaskIdLoading) {
		return <ArtifactLoading className={className} />
	}

	if (!hasArtifactId) {
		return <ArtifactError filePath={filePath} message="could not determine artifact ID" className={className} />
	}

	if (!taskId) {
		return <ArtifactError filePath={filePath} message="could not determine task ID" className={className} />
	}

	if (!artifact) {
		return <ArtifactError filePath={filePath} message="artifact not found or not synced" className={className} />
	}

	if (!artifactUrl) {
		return <ArtifactError filePath={filePath} message="artifact preview not available" className={className} />
	}

	if (isImage) {
		return (
			<ArtifactImage
				url={artifactUrl}
				fileName={fileName}
				className={className}
				isFullscreenOpen={isFullscreenOpen}
				onFullscreenChange={setIsFullscreenOpen}
			/>
		)
	}

	return (
		<ArtifactIframe
			url={artifactUrl}
			fileName={fileName}
			iframeRenderKey={artifact.last_updated_at?.toString()}
			className={className}
			isFullscreenOpen={isFullscreenOpen}
			onFullscreenChange={setIsFullscreenOpen}
		/>
	)
}
