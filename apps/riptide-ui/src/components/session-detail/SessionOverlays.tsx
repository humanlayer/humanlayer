import { ArtifactFullscreenModal } from '@humanlayer/ui/components/artifact-fullscreen-modal'
import { BypassPermissionsDialog } from '@humanlayer/ui/components/bypass-permissions-dialog'
import { BypassPermissionsNudgeDialog } from '@humanlayer/ui/components/bypass-permissions-nudge-dialog'
import { IterateConfirmDialog } from '@humanlayer/ui/components/iterate-confirm-dialog'

import { ArtifactFullscreenPanel } from '@/components/ArtifactFullscreenPanel'
import { DiffFullscreenReview } from '@/components/diffs/DiffFullscreenReview'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { InterruptConfirmDialog } from '@/components/InterruptConfirmDialog'
import { LaunchDaemonModal } from '@/components/launch-daemon/LaunchDaemonModal'
import { deriveSessionArtifactHost } from '@/components/session-detail/session-artifact-host'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useOptionalSessionDiff } from '@/components/session-detail/session-diff-context'
import { WiredToolResultModal } from '@/components/WiredToolResultModal'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

/**
 * All modal/dialog overlays for the session detail page: tool result modal,
 * bypass permissions dialogs (manual + nudge), iterate confirm, interrupt
 * confirm, launch daemon, and the fullscreen artifact viewer.
 */
export function SessionOverlays({ pendingFullscreenArtifactId }: { pendingFullscreenArtifactId?: string }) {
	const sessionDetail = useSessionDetail()
	const {
		session,
		conversation,
		modalEvent,
		modalResult,
		closeToolModal,
		handleOpenFile,
		pendingInterruptIntent,
		closeInterruptDialog,
		sendControls,
		permissionControls,
		autoAdvance,
		host,
		artifactPanel,
	} = sessionDetail
	const artifactHost = deriveSessionArtifactHost({ ...sessionDetail, pendingFullscreenArtifactId })
	const taskDiffReview = useOptionalSessionDiff()
	const confirmBeforeInterruptingSubAgents = useSettingsStore((s) => s.confirmBeforeInterruptingSubAgents)
	const setConfirmBeforeInterruptingSubAgents = useSettingsStore((s) => s.setConfirmBeforeInterruptingSubAgents)
	const enableCreatingPubliclyShareableLinks = useSettingsStore(
		(s) => s.orgSettings.enableCreatingPubliclyShareableLinks,
	)
	const { launchDaemon } = host
	const { selectedArtifact, selectedArtifactId } = artifactPanel

	return (
		<>
			{/* Tool Result Modal - nested scope with rootScopeDisabled */}
			<WiredToolResultModal
				toolCall={modalEvent}
				toolResult={modalResult}
				workingDir={session.working_directory}
				onClose={closeToolModal}
				onOpenFile={handleOpenFile}
			/>

			{/* Bypass Permissions Dialog (manual via ⌥+Y) */}
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				isActive={permissionControls.bypassDialogOpen}
				rootScopeDisabled={true}
				componentName="BypassPermissionsDialog"
			>
				<BypassPermissionsDialog
					open={permissionControls.bypassDialogOpen}
					onOpenChange={permissionControls.setBypassDialogOpen}
					onConfirm={permissionControls.handleBypassConfirm}
					hotkeyScope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				/>
			</HotkeyScopeBoundary>

			{/* Bypass Permissions Nudge Dialog (auto-triggered after N approvals) */}
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_NUDGE_DIALOG}
				isActive={permissionControls.bypassNudgeOpen}
				rootScopeDisabled={true}
				componentName="BypassPermissionsNudgeDialog"
			>
				<BypassPermissionsNudgeDialog
					open={permissionControls.bypassNudgeOpen}
					onOpenChange={(open) => {
						if (!open) {
							permissionControls.dismissBypassNudge()
						}
					}}
					onConfirm={(timeout) => {
						permissionControls.handleBypassConfirm(timeout)
						permissionControls.dismissBypassNudge()
					}}
					hotkeyScope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_NUDGE_DIALOG}
					onSilencedChange={permissionControls.setBypassNudgeSilenced}
				/>
			</HotkeyScopeBoundary>

			{/* Iterate Confirm Dialog */}
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.ITERATE_CONFIRM_DIALOG}
				isActive={autoAdvance.iterateDialogOpen}
				rootScopeDisabled={true}
				componentName="IterateConfirmDialog"
			>
				<IterateConfirmDialog
					open={autoAdvance.iterateDialogOpen}
					onOpenChange={autoAdvance.setIterateDialogOpen}
					onConfirm={autoAdvance.handleIterateConfirm}
					silenced={autoAdvance.iterateDialogSilenced ?? false}
					onSilencedChange={autoAdvance.setIterateDialogSilenced}
					hotkeyScope={HOTKEY_SCOPES.ITERATE_CONFIRM_DIALOG}
				/>
			</HotkeyScopeBoundary>

			{/* Interrupt Confirm Dialog */}
			<InterruptConfirmDialog
				open={pendingInterruptIntent !== null}
				onOpenChange={(open) => {
					if (!open) closeInterruptDialog()
				}}
				onConfirm={sendControls.handleInterruptConfirm}
				onCancel={sendControls.handleInterruptCancel}
				runningSubAgents={conversation.runningSubAgents}
				silenced={!confirmBeforeInterruptingSubAgents}
				onSilencedChange={(silenced) => setConfirmBeforeInterruptingSubAgents(!silenced)}
			/>

			<LaunchDaemonModal
				open={host.launchModalOpen}
				onOpenChange={(open) => {
					host.setLaunchModalOpen(open)
					if (!open) {
						launchDaemon.reset()
					}
				}}
				state={launchDaemon.state}
				onLaunch={launchDaemon.launch}
				onReset={launchDaemon.reset}
				canLaunch={launchDaemon.canLaunch}
				isRunning={launchDaemon.isRunning}
			/>

			{/* Only a rendered persistent owner replaces the overlay; fork mode still needs the fallback. */}
			{!artifactHost.presentation &&
				artifactPanel.isArtifactFullscreen &&
				selectedArtifactId &&
				selectedArtifact?.task_id && (
					<ArtifactFullscreenPanel
						key={selectedArtifactId}
						artifactId={selectedArtifactId}
						taskId={selectedArtifact.task_id}
						resourceOwnerUserId={selectedArtifact?.resource_owner_user_id}
						artifact={selectedArtifact}
						artifacts={artifactPanel.sessionArtifacts}
						onArtifactSelect={artifactPanel.handleArtifactClick}
						imageUrl={artifactPanel.selectedArtifactImageUrl}
						isOwner={artifactPanel.isArtifactOwner}
						viewMode={artifactPanel.effectiveViewMode}
						onViewModeChange={artifactPanel.setViewMode}
						onClose={artifactPanel.closeFullscreen}
						hideShareableLinkOption={!enableCreatingPubliclyShareableLinks}
					/>
				)}

			{/* Content-only fullscreen modal for previewable artifacts (image / HTML / PDF) */}
			{artifactPanel.isFullscreenModalOpen && selectedArtifact && artifactPanel.selectedArtifactImageUrl && (
				<HotkeyScopeBoundary
					scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
					isActive
					rootScopeDisabled
					componentName="ArtifactFullscreenModal"
				>
					<ArtifactFullscreenModal
						open
						onOpenChange={artifactPanel.setFullscreenModalOpen}
						fileName={selectedArtifact.file_name ?? ''}
						url={artifactPanel.selectedArtifactImageUrl}
						iframeRenderKey={selectedArtifact.last_updated_at?.toString()}
						htmlSandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
					/>
				</HotkeyScopeBoundary>
			)}

			{taskDiffReview?.activePresentation === 'fullscreen' && (
				<DiffFullscreenReview
					model={taskDiffReview}
					deliveryTarget={{ kind: 'session', sessionId: session.id }}
				/>
			)}
		</>
	)
}
