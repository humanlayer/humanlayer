import { useNavigate } from '@tanstack/react-router'

import { hostBlockedMessage } from '@/components/provider-sign-in/provider-sign-in-labels'
import { useProviderLogin } from '@/hooks/useProviderLogin'

import { SignInHostHeader } from './SignInHost'
import { UpdateCliPopover } from './UpdateCliPopover'

export function WiredHostSignInHeader({
	hostId,
	hostName,
	online,
}: {
	hostId: string
	hostName: string | null
	online: boolean
}) {
	const navigate = useNavigate()
	const { host } = useProviderLogin(hostId)
	const shortId = hostId.slice(0, 8)
	return (
		<SignInHostHeader name={hostName ?? shortId} shortId={shortId} online={online}>
			{host.state === 'offline' ? <span>Offline</span> : null}
			{host.state === 'outdated' ? (
				<UpdateCliPopover
					message={hostBlockedMessage(host)}
					onOpenDaemonSettings={() => void navigate({ to: '/settings/daemons' })}
				/>
			) : null}
		</SignInHostHeader>
	)
}
