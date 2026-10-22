import type { FC } from 'react'

import { OpenPullRequestRow } from './OpenPullRequestRow'
import { useOpenPullRequestDelivery } from './useOpenPullRequestDelivery'

/** The session a send goes to; null on a task page, where the prompt is copied instead. */
export const WiredOpenPullRequestRow: FC<{ sessionId: string | null }> = ({ sessionId }) => {
	const delivery = useOpenPullRequestDelivery(sessionId)
	return (
		<OpenPullRequestRow
			kind={delivery.kind}
			pending={delivery.pending}
			sent={delivery.sent}
			error={delivery.error}
			onOpen={delivery.open}
		/>
	)
}
