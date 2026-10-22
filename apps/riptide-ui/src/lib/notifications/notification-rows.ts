import type { NotificationRow } from './notification-row'
import type { NotificationSources } from './notification-sources'
import { approvalRows } from './rows/approval-rows'
import { artifactCommentRows } from './rows/artifact-comment-rows'
import { diffCommentRows } from './rows/diff-comment-rows'
import { sessionFailureRows, workspaceSetupRows } from './rows/failure-rows'
import { promptInviteRows } from './rows/prompt-invite-rows'
import { readyForInputRows } from './rows/ready-for-input-rows'
import { createRowContext } from './rows/row-context'

export function deriveNotificationRows(sources: NotificationSources): NotificationRow[] {
	const context = createRowContext(sources)
	return [
		...approvalRows(context),
		...readyForInputRows(context),
		...sessionFailureRows(context),
		...workspaceSetupRows(context),
		...promptInviteRows(context),
		...artifactCommentRows(context),
		...diffCommentRows(context),
	].sort((a, b) => b.at - a.at)
}
