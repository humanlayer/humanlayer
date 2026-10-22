import { useUpdate } from '@/hooks/use-update'
import { useSafeUpdate } from '@/hooks/useSafeUpdate'
import { openExternalUrl } from '@/integrations/desktop/external-url'

import { Dialog } from './Dialog'
import { Prose } from './Prose'

/** What the update is about to do, or why it can't. Errors go to the dialog's error line instead. */
function statusLine(state: ReturnType<typeof useSafeUpdate>, isDownloading: boolean): string | null {
	if (isDownloading) return 'Downloading and installing…'
	if (state.isInterruptingSessions) return 'Stopping active sessions…'
	if (state.shutdownError || state.installError || state.isError) return null
	if (state.isLoading || !state.isReady) return 'Checking for active sessions…'
	const count = state.affectedSessionCount
	if (count > 0)
		return `Updating stops ${count} active ${count === 1 ? 'session' : 'sessions'} on this computer. Finish your work first, or choose Later.`
	return 'HumanLayer restarts after it updates.'
}

function errorLine(state: ReturnType<typeof useSafeUpdate>): string | null {
	if (state.shutdownError)
		return 'Could not stop active sessions, so the update did not start. Try again, or force the update to stop them anyway.'
	if (state.installError) return 'Could not install the update. Try again later.'
	if (state.isError) return 'Could not check for active sessions. Try again later.'
	return null
}

function confirmLabel(state: ReturnType<typeof useSafeUpdate>, isDownloading: boolean): string {
	if (isDownloading) return 'Installing…'
	if (state.isInterruptingSessions) return 'Stopping sessions…'
	if (state.affectedSessionCount > 0) return 'Stop sessions and update'
	return 'Update and restart'
}

/** The app update: what's new, what installing stops, and the install itself. Mount it only while open. */
export function UpdateDialog() {
	const { update, isDownloading, urgency, changelogUrl, setUpdateModalOpen } = useUpdate()
	const state = useSafeUpdate()
	if (!update) return null
	const status = statusLine(state, isDownloading)
	return (
		<Dialog
			title={urgency === 'critical' ? 'Install this update now' : 'Update available'}
			description={`v${update.currentVersion} → v${update.version}${urgency === 'critical' ? '. It fixes a serious problem, so install it as soon as you can.' : ''}`}
			busy={state.closeDisabled}
			error={errorLine(state)}
			onClose={() => setUpdateModalOpen(false)}
			onSubmit={state.confirm}
		>
			{update.body.trim() ? (
				<div className="update-notes">
					<Prose text={update.body} />
				</div>
			) : null}
			{changelogUrl ? (
				<button type="button" className="update-link" onClick={() => void openExternalUrl(changelogUrl)}>
					All release notes
				</button>
			) : null}
			{status ? <p className="update-status">{status}</p> : null}
			<div className="dialog-actions">
				{state.shutdownError ? (
					<button type="button" className="btn aside" disabled={state.closeDisabled} onClick={state.force}>
						Force update
					</button>
				) : null}
				<button
					type="button"
					className="btn"
					disabled={state.closeDisabled}
					onClick={() => setUpdateModalOpen(false)}
				>
					Later
				</button>
				<button type="submit" className="btn primary" disabled={state.confirmDisabled}>
					{confirmLabel(state, isDownloading)} <span className="kbd inv">⌘⏎</span>
				</button>
			</div>
		</Dialog>
	)
}
