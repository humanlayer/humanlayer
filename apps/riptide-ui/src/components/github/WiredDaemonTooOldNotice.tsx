import { useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'

import { DaemonTooOldNotice } from './DaemonTooOldNotice'

/**
 * Daemon settings is the one screen that fixes this on either kind of host: it relaunches a
 * packaged daemon and it mints the token for the `@humanlayer/cli` launch command, which is the
 * only route on a platform the app is not published for.
 */
export const WiredDaemonTooOldNotice: FC<{ hostName: string | null }> = ({ hostName }) => {
	const navigate = useNavigate()
	return (
		<DaemonTooOldNotice
			hostName={hostName}
			onOpenDaemonSettings={() => void navigate({ to: '/settings/daemons' })}
		/>
	)
}
