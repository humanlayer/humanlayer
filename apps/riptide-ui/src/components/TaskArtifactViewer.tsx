import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent } from '@humanlayer/ui/components/dialog'
import { cn } from '@humanlayer/ui/lib/utils'
import { Expand, Loader2 } from 'lucide-react'
import { memo, use, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { SyncContext } from '@/components/providers/SyncContext'
import { ArtifactImagePreview, TaskArtifactInline } from '@/components/TaskArtifactInline'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'
import { getArtifactDisplayName, isImageFileName, toTaskArtifactReference } from '@/lib/task-artifact-path'

export interface TaskArtifactViewerProps {
	/** File path to the artifact. Can be passed as `code` (from TipTap) or `filePath`. */
	code?: string
	filePath?: string
	className?: string
}

function ArtifactLoading({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-center justify-center gap-2 bg-muted/50 rounded p-4 min-h-[100px]', className)}>
			<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			<span className="text-sm text-muted-foreground">Loading artifact…</span>
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
			<div className={cn('relative overflow-hidden', className)}>
				<iframe
					key={iframeRenderKey}
					src={url}
					title={fileName}
					className="w-full h-[500px] border-0"
					sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
				/>
				<div className="absolute right-2 top-8" contentEditable={false}>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Expand to fullscreen"
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
							sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
							tabIndex={-1}
						/>
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
})

/**
 * TaskArtifactViewer renders HTML and other artifact files from the task directory
 * in a sandboxed iframe with fullscreen support.
 */
export function TaskArtifactViewer({ code, filePath: filePathProp, className }: TaskArtifactViewerProps) {
	const sync = use(SyncContext)
	if (!sync) {
		return (
			<pre
				className={cn(
					'whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs font-mono text-muted-foreground',
					className,
				)}
			>
				<code>{code ?? filePathProp ?? ''}</code>
			</pre>
		)
	}
	return <SyncedTaskArtifactViewer code={code} filePath={filePathProp} className={className} />
}

function SyncedTaskArtifactViewer({ code, filePath: filePathProp, className }: TaskArtifactViewerProps) {
	const filePath = code ?? filePathProp ?? ''
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)

	const reference = toTaskArtifactReference(filePath)
	const { fileName } = reference
	const { artifact, url: artifactUrl, isLoading: isUrlLoading, error: urlError } = useTaskArtifactUrl(reference)

	if (urlError) {
		return <ArtifactError filePath={filePath} message={urlError.message} className={className} />
	}

	if (isUrlLoading) {
		return <ArtifactLoading className={className} />
	}

	if (!artifact) {
		return <ArtifactError filePath={filePath} message="artifact not found or not synced" className={className} />
	}

	if (!artifactUrl) {
		return <TaskArtifactInline path={filePath} />
	}

	if (isImageFileName(fileName)) {
		return <ArtifactImagePreview url={artifactUrl} alt={getArtifactDisplayName(fileName)} className={className} />
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
