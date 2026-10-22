import { AGENT_LABELS } from '@/components/onboarding/agent-setup/agent-status'
import { providerSignInStatusLabel } from '@/components/provider-sign-in/provider-sign-in-labels'
import type { ProviderSignInProvider } from '@/components/provider-sign-in/ProviderSignInCard'
import { useCodingAgentAuth } from '@/hooks/use-coding-agent-auth'
import { useProviderSignIn } from '@/hooks/useProviderSignIn'

import { signInStatusTone } from './sign-in-status'
import { SignInAgentRow, SignInRowStatus } from './SignInHost'
import { WiredProviderSignInCells } from './WiredProviderSignInCells'

export function WiredHostAgentSignInRow({ hostId, provider }: { hostId: string; provider: ProviderSignInProvider }) {
	const { request } = useProviderSignIn(hostId, provider)
	const { isSignedIn } = useCodingAgentAuth({ id: hostId, isColocated: false }, provider)
	return (
		<SignInAgentRow name={AGENT_LABELS[provider]}>
			<SignInRowStatus
				label={providerSignInStatusLabel(request) ?? 'No sign-in from HumanLayer'}
				tone={signInStatusTone(request, isSignedIn)}
			>
				{request?.status === 'succeeded' && request.accountLabel ? (
					<p className="text-foreground">{request.accountLabel}</p>
				) : null}
			</SignInRowStatus>
			<WiredProviderSignInCells hostId={hostId} provider={provider} />
		</SignInAgentRow>
	)
}
