import { ArtifactViewer, ArtifactViewerTabs, type ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@humanlayer/ui/components/sheet'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronLeft, FileText } from 'lucide-react'
import type { FC, ReactNode } from 'react'

export interface MobileArtifactItem {
	artifactId: string
	filename: string
	/** Category label e.g. 'source', 'new', 'edited', 'unreferenced' */
	category: string
	/** Has comment threads with agent/teammate activity the user hasn't viewed. */
	hasUnreadComments?: boolean
}

export interface MobileArtifactSheetProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	artifacts: MobileArtifactItem[]
	selectedArtifactId: string | null
	selectedArtifactContent?: string
	onArtifactSelect: (artifactId: string) => void
	onArtifactClose: () => void
	artifactViewerSlot?: ReactNode
	/** Optional control rendered in the viewer header, right of the filename
	 * (e.g. a "N comments" affordance wired up by WiredMobileArtifactSheet). */
	headerAccessory?: ReactNode
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	/** Send text directly to the owning session (used by the comment drawer's
	 * Send action in WiredMobileArtifactSheet). Only the session page provides
	 * this — the task page has no session context, so Send is hidden there.
	 * Returns how the message was dispatched, or false when blocked. */
	onSendToSession?: (text: string) => 'queued' | 'sent' | false
}

function getCategoryColor(category: string): string {
	switch (category) {
		case 'new':
			return 'text-[var(--terminal-success)]'
		case 'edited':
			return 'text-[var(--terminal-warning)]'
		case 'source':
			return 'text-[var(--terminal-accent)]'
		default:
			return 'text-muted-foreground'
	}
}

/**
 * Slide-in Sheet (from the right) that shows:
 *   - Artifact list view when no artifact is selected
 *   - Artifact content viewer when an artifact is selected
 */
export const MobileArtifactSheet: FC<MobileArtifactSheetProps> = ({
	isOpen,
	onOpenChange,
	artifacts,
	selectedArtifactId,
	selectedArtifactContent,
	onArtifactSelect,
	onArtifactClose,
	artifactViewerSlot,
	headerAccessory,
	viewMode,
	onViewModeChange,
}) => {
	const selectedArtifact = selectedArtifactId ? artifacts.find((a) => a.artifactId === selectedArtifactId) : null

	return (
		<Sheet open={isOpen} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className={cn(
					'p-0 flex flex-col',
					// Viewer mode hides the Sheet's built-in close X: the back caret
					// handles navigation there, and the X collided with the comments
					// accessory in the same corner. List mode keeps it as the dismiss.
					selectedArtifact
						? 'w-screen max-w-none sm:max-w-none rounded-none [&>button]:hidden'
						: 'w-[85vw] max-w-[360px]',
				)}
				style={selectedArtifact ? { height: 'calc(100dvh - var(--keyboard-inset, 0px))' } : undefined}
			>
				<SheetHeader className="sr-only">
					<SheetTitle>Artifacts</SheetTitle>
				</SheetHeader>

				{selectedArtifact ? (
					/* Artifact viewer */
					<div className="flex flex-col h-full overflow-hidden">
						{/* Viewer header with back button */}
						<div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
							<button
								type="button"
								onClick={onArtifactClose}
								className="flex h-11 w-11 -ml-2 shrink-0 items-center justify-center rounded hover:bg-accent/10 transition-colors"
								aria-label="Back to artifact list"
							>
								<ChevronLeft className="h-4 w-4 text-muted-foreground" />
							</button>
							<span className="flex-1 min-w-0 text-sm font-medium truncate font-mono">
								{selectedArtifact.filename}
							</span>
							<ArtifactViewerTabs
								value={viewMode}
								onValueChange={onViewModeChange}
								fileName={selectedArtifact.filename}
							/>
							{headerAccessory}
						</div>

						{/* Content area — uses the shared ArtifactViewer (TipTap markdown for .md, raw for everything else). */}
						<div className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
							{selectedArtifactContent !== undefined ? (
								(artifactViewerSlot ?? (
									<ArtifactViewer
										content={selectedArtifactContent}
										fileName={selectedArtifact.filename}
										noBorder
										hideHeader
										showHotkeyHints={false}
										hideCommentGutter
										tabValue={viewMode}
										onTabValueChange={onViewModeChange}
									/>
								))
							) : (
								<div className="flex items-center justify-center h-full text-sm text-muted-foreground">
									Loading…
								</div>
							)}
						</div>
					</div>
				) : (
					/* Artifact list */
					<div className="flex flex-col h-full overflow-hidden">
						<div className="px-4 py-3 border-b border-border shrink-0">
							<p className="text-sm font-medium">Artifacts</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								{artifacts.length} file{artifacts.length !== 1 ? 's' : ''}
							</p>
						</div>

						<div className="flex-1 overflow-y-auto overscroll-contain">
							{artifacts.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
									<FileText className="h-8 w-8 opacity-40" />
									<p className="text-sm">No artifacts yet</p>
								</div>
							) : (
								<div className="divide-y divide-border">
									{artifacts.map((artifact) => (
										<button
											key={artifact.artifactId}
											type="button"
											onClick={() => onArtifactSelect(artifact.artifactId)}
											className={cn(
												'w-full flex items-center gap-3 px-4 py-3 min-h-[48px]',
												'text-left hover:bg-accent/5 active:bg-accent/10 transition-colors',
											)}
										>
											<FileText
												className={cn('h-4 w-4 shrink-0', getCategoryColor(artifact.category))}
											/>
											<div className="flex-1 min-w-0">
												<p className="text-sm font-mono truncate">{artifact.filename}</p>
												<p
													className={cn(
														'text-xs capitalize',
														getCategoryColor(artifact.category),
													)}
												>
													{artifact.category}
												</p>
											</div>
											{artifact.hasUnreadComments && (
												<span
													className="size-1.5 shrink-0 bg-[var(--terminal-accent)]"
													aria-label="New comment activity"
												/>
											)}
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</SheetContent>
		</Sheet>
	)
}
