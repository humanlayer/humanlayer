import type { ReactNode } from 'react'

import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { MobileEffortSelector } from '@/mobile/components/pure/MobileEffortSelector'
import { MobileInput, type MobileInputStatusTone } from '@/mobile/components/pure/MobileInput'
import { MobileModelSelector } from '@/mobile/components/pure/MobileModelSelector'
import { useMobileSessionControls } from '@/mobile/hooks/useMobileSessionControls'

type MobileSessionControlsArgs = Parameters<typeof useMobileSessionControls>[0]

interface WiredMobileSessionComposerRenderState {
	composer: ReactNode
	/** Dispatch text to the session; reports how it went out ('queued' while
	 * running) or false when blocked by permissions/status. */
	sendMessageToSession: (text: string) => 'queued' | 'sent' | false
	commentsUnreadCount: number
	commentsUnreadArtifactIds: ReadonlySet<string>
}

interface WiredMobileSessionComposerProps extends MobileSessionControlsArgs {
	isDenying: boolean
	onDenySubmit: (feedback: string) => void
	onCancelDeny?: () => void
	children: (state: WiredMobileSessionComposerRenderState) => ReactNode
}

function getStatusTone(status?: string | null): MobileInputStatusTone {
	switch (status) {
		case 'launching':
		case 'resuming':
			return 'accent'
		case 'running':
		case 'ready_for_input':
			return 'success'
		case 'needs_approval':
		case 'interrupt_requested':
		case 'interrupted':
		case 'lost':
			return 'warning'
		case 'failed':
			return 'error'
		case 'draft':
			return 'muted'
		default:
			return 'default'
	}
}

export function WiredMobileSessionComposer({
	session,
	currentTask,
	sessionActions,
	taskSettings,
	updateAutoAdvance,
	canSendPrompt,
	sessionId,
	onToggleArchive,
	isDenying,
	onDenySubmit,
	onCancelDeny,
	children,
}: WiredMobileSessionComposerProps) {
	const controls = useMobileSessionControls({
		session,
		currentTask,
		sessionActions,
		taskSettings,
		updateAutoAdvance,
		canSendPrompt,
		sessionId,
		onToggleArchive,
	})
	const selectedModelLabel =
		controls.modelOptions.find((option) => option.value === controls.selectedModel)?.label ?? controls.selectedModel

	const handleComposerSend = () => {
		if (isDenying) {
			onDenySubmit(controls.inputValue.trim())
			controls.setInputValue('')
			return
		}
		controls.handleSend()
	}

	return (
		<>
			{children({
				composer: (
					<>
						<MobileInput
							value={controls.inputValue}
							onChange={controls.setInputValue}
							onSend={handleComposerSend}
							disabled={!session || !canSendPrompt || controls.isResponseEditorDisabled}
							submitDisabled={isDenying ? false : controls.isSubmitDisabled}
							statusLabel={
								isDenying ? 'TELL CLAUDE WHAT TO DO DIFFERENTLY' : (controls.statusLabel ?? undefined)
							}
							statusTone={isDenying ? 'error' : getStatusTone(session?.status)}
							actionButtons={controls.inputActionButtons}
							submitMode={controls.submitMode}
							attachments={controls.attachments}
							onRemoveAttachment={controls.handleRemoveAttachment}
							pendingUploadCount={controls.pendingUploadCount}
							onInterrupt={controls.handleInterruptOnly}
							interruptDisabled={controls.isInterruptDisabled}
							denyMode={isDenying}
							onCancelDeny={onCancelDeny}
							modelLabel={selectedModelLabel}
							onModelClick={() => controls.setIsModelSelectorOpen(true)}
							modelDisabled={
								!session || controls.isAgentSettingsLocked || session.status === 'interrupt_requested'
							}
							showEffort={controls.effortSupported}
							effortLabel={controls.effortLabel}
							onEffortClick={() => controls.setIsEffortSelectorOpen(true)}
							effortDisabled={controls.isEffortDisabled}
							showFastMode={controls.fastModeSupported}
							fastModeEnabled={controls.fastModeEnabled}
							onFastModeToggle={controls.handleFastModeToggle}
							fastModeDisabled={controls.isFastModeDisabled}
							contextCounter={controls.contextCounter}
							infoRow={controls.inputInfoRow}
							commentsCount={controls.commentsUnresolvedCount}
							onSendComments={controls.handleSendCommentsAndResolve}
							sendCommentsDisabled={controls.isSendCommentsDisabled}
						/>

						<MobileModelSelector
							open={controls.isModelSelectorOpen}
							onOpenChange={controls.setIsModelSelectorOpen}
							value={controls.selectedModel}
							options={controls.modelOptions}
							onChange={controls.handleModelChange}
						/>

						{controls.effortSupported && controls.effortLevels.length > 0 && (
							<MobileEffortSelector
								open={controls.isEffortSelectorOpen}
								onOpenChange={controls.setIsEffortSelectorOpen}
								value={controls.selectedEffort}
								levels={controls.effortLevels}
								onChange={controls.handleEffortChange}
							/>
						)}

						{controls.fastModeSupported && (
							<FastModeWarningDialog
								open={controls.fastModePendingEnable}
								onOpenChange={controls.setFastModePendingEnable}
								onConfirm={controls.confirmFastMode}
							/>
						)}
					</>
				),
				sendMessageToSession: controls.sendMessageToSession,
				commentsUnreadCount: controls.commentsUnreadCount,
				commentsUnreadArtifactIds: controls.commentsUnreadArtifactIds,
			})}
		</>
	)
}
