import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Download } from 'lucide-react'
import { type ReactNode, useCallback } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useUpdate } from '@/hooks/use-update'
import { useSafeUpdate } from '@/hooks/useSafeUpdate'
import { openExternal } from '@/lib/url-opener'

function getUpdateStatusMessage({
	isDownloading,
	isInterruptingSessions,
	shutdownError,
	isError,
	isLoading,
	isReady,
	affectedSessionCount,
}: {
	isDownloading: boolean
	isInterruptingSessions: boolean
	shutdownError: boolean
	isError: boolean
	isLoading: boolean
	isReady: boolean
	affectedSessionCount: number
}): ReactNode {
	if (isDownloading) {
		return (
			<div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
				<SyncGridAnimation variant="snake" size="xs" speed={120} />
				<span>Downloading and installing update…</span>
			</div>
		)
	}
	if (isInterruptingSessions) {
		return (
			<div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
				<SyncGridAnimation variant="snake" size="xs" speed={120} />
				<span>Interrupting active sessions…</span>
			</div>
		)
	}
	if (shutdownError) {
		return (
			<p className="text-sm text-destructive">
				The update could not stop sessions safely. Retry, choose Later, or force the update. Forcing will
				interrupt any active sessions.
			</p>
		)
	}
	if (isError) {
		return <p className="text-sm text-destructive">Could not check active sessions. Try again later.</p>
	}
	if (isLoading || !isReady) {
		return <p className="text-sm text-muted-foreground">Checking active sessions...</p>
	}
	if (affectedSessionCount > 0) {
		return (
			<p className="text-sm text-destructive">
				Updating will interrupt {affectedSessionCount}{' '}
				{affectedSessionCount === 1 ? 'active session' : 'active sessions'} on this device. Finish your work
				before updating, or choose Later.
			</p>
		)
	}
	return (
		<p className="text-sm text-muted-foreground">
			The application will restart after updating. You can come back to your current session afterward.
		</p>
	)
}

function getConfirmButtonLabel(
	isDownloading: boolean,
	isInterruptingSessions: boolean,
	hasAffectedSessions: boolean,
): string {
	if (isDownloading) return 'Installing...'
	if (isInterruptingSessions) return 'Interrupting...'
	if (hasAffectedSessions) return 'Interrupt All Sessions & Update'
	return 'Update & Restart'
}

export function UpdateDetailsDialog() {
	const { update, isDownloading, urgency, changelogUrl, updateModalOpen, setUpdateModalOpen } = useUpdate()
	const {
		affectedSessionCount,
		isLoading,
		isReady,
		isError,
		shutdownError,
		isInterruptingSessions,
		closeDisabled,
		confirmDisabled,
		confirm: handleConfirm,
		force: handleForceUpdate,
	} = useSafeUpdate({
		onShutdownError: () => toast.error('Failed to interrupt active sessions. Update not started.'),
	})
	const hasAffectedSessions = affectedSessionCount > 0

	const handleCancel = useCallback(() => {
		if (closeDisabled) return
		setUpdateModalOpen(false)
	}, [closeDisabled, setUpdateModalOpen])

	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancel()
				return
			}
			setUpdateModalOpen(true)
		},
		[handleCancel, setUpdateModalOpen],
	)

	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleConfirm()
		},
		{
			enabled: updateModalOpen && !confirmDisabled,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.UPDATE_DIALOG],
		},
		[updateModalOpen, handleConfirm, confirmDisabled],
	)

	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		},
		{
			enabled: updateModalOpen && !closeDisabled,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.UPDATE_DIALOG],
		},
		[updateModalOpen, handleCancel, closeDisabled],
	)

	if (!update) return null

	const updateStatusMessage = getUpdateStatusMessage({
		isDownloading,
		isInterruptingSessions,
		shutdownError,
		isError,
		isLoading,
		isReady,
		affectedSessionCount,
	})
	const confirmButtonLabel = getConfirmButtonLabel(isDownloading, isInterruptingSessions, hasAffectedSessions)

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.UPDATE_DIALOG} isActive={updateModalOpen}>
			<Dialog open={updateModalOpen} onOpenChange={handleOpenChange}>
				<DialogContent
					className="update-details-dialog grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden max-h-[85vh]"
					style={{ width: 'min(90%, 44rem)', maxWidth: 'min(90%, 44rem)' }}
					onEscapeKeyDown={(e) => e.preventDefault()}
					onPointerDownOutside={(e) => e.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-base font-bold">
							<Download className="h-4 w-4 text-[var(--terminal-success)]" />
							{urgency === 'critical' ? '[URGENT] Update Available' : 'Update Available'}
						</DialogTitle>
						<DialogDescription asChild>
							<div className="space-y-3 text-sm">
								<div className="flex items-center gap-4 font-mono">
									<span className="text-muted-foreground">Current: v{update.currentVersion}</span>
									<span className="text-[var(--terminal-success)]">→ v{update.version}</span>
									{changelogUrl && (
										<span className="text-muted-foreground">
											(
											<a
												href={changelogUrl}
												onClick={(e) => {
													e.preventDefault()
													void openExternal(changelogUrl)
												}}
												className="text-accent underline hover:text-accent/80 transition-colors"
											>
												View full changelog
											</a>
											)
										</span>
									)}
								</div>
								{urgency === 'critical' && (
									<p className="font-bold text-foreground">
										It is strongly recommended to apply this update immediately.
									</p>
								)}
							</div>
						</DialogDescription>
					</DialogHeader>
					{update.body.trim() ? (
						<div className="overflow-y-auto text-sm">
							<MarkdownRenderer content={update.body} />
						</div>
					) : (
						<div />
					)}
					<div className="space-y-3">
						{updateStatusMessage}
						<DialogFooter>
							<Button variant="secondary" onClick={handleCancel} disabled={closeDisabled}>
								Later
								{!closeDisabled && <KeyboardShortcut size="xs">Esc</KeyboardShortcut>}
							</Button>
							{shutdownError && (
								<Button variant="destructive" onClick={handleForceUpdate} disabled={closeDisabled}>
									Force Update & Restart
								</Button>
							)}
							<Button
								variant={
									hasAffectedSessions || isInterruptingSessions ? 'destructive' : 'loud-success-cta'
								}
								onClick={handleConfirm}
								disabled={confirmDisabled}
							>
								{confirmButtonLabel}
								{!closeDisabled && isReady && <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>}
							</Button>
						</DialogFooter>
					</div>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
