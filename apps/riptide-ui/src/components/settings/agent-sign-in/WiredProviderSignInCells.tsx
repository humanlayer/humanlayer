import {
	ProviderSignInAction,
	ProviderSignInMessages,
	type ProviderSignInProvider,
} from '@/components/provider-sign-in/ProviderSignInCard'
import { ProviderSignInTerminalFallback } from '@/components/provider-sign-in/ProviderSignInTerminalFallback'
import { useCodingAgentAuth } from '@/hooks/use-coding-agent-auth'
import { isSignInActive, useProviderSignIn } from '@/hooks/useProviderSignIn'
import { openExternalUrl } from '@/integrations/desktop/external-url'

import { SignInRowActions, SignInRowDetail } from './SignInHost'

/** Terminal fallback stays visible unless the agent already works on the host. */
export function WiredProviderSignInCells({
	hostId,
	provider,
	isColocated = false,
	onSignedIn,
}: {
	hostId: string
	provider: ProviderSignInProvider
	isColocated?: boolean
	onSignedIn?: () => void
}) {
	const { host, request, start, cancel, submitCode, isStarting } = useProviderSignIn(hostId, provider, onSignedIn)
	const { isSignedIn: hasWorkingSignIn } = useCodingAgentAuth({ id: hostId, isColocated }, provider)
	const showFlow = isSignInActive(request) || request?.error
	return (
		<>
			<SignInRowActions>
				<ProviderSignInAction
					provider={provider}
					request={request}
					host={host}
					isStarting={isStarting}
					hasWorkingSignIn={hasWorkingSignIn}
					size="xs"
					onSignIn={start}
					onCancel={cancel}
				/>
			</SignInRowActions>
			{showFlow || !hasWorkingSignIn ? (
				<SignInRowDetail>
					{showFlow ? (
						<ProviderSignInMessages
							request={request}
							size="xs"
							onSubmitCode={submitCode}
							onOpenUrl={(url) => void openExternalUrl(url)}
						/>
					) : null}
					<ProviderSignInTerminalFallback provider={provider} />
				</SignInRowDetail>
			) : null}
		</>
	)
}
