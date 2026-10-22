import { useCallback } from 'react'

import { type AgentType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { getCodelayerProviderForLaunch } from '@/lib/auto-advance'

/**
 * Compatibility adapter for the mobile V2 agent picker. New launchers should use
 * `useCodingAgentSetupGuard` directly with their selected agent, provider, and host.
 */
export function useCodelayerSetupGuard(commit: (agent: AgentType) => void) {
	const defaultProvider = useSettingsStore((state) => state.defaultCodelayerProvider)
	const useFoldCodingAgent = useSettingsStore((state) => state.useFoldCodingAgent)
	const { hostId } = useEffectiveHost()
	const setupHost = useCodingAgentSetupHost(hostId)
	const { guardSetup } = useCodingAgentSetupGuard()

	const onAgentChange = useCallback(
		(next: AgentType) => {
			if (next !== 'codelayer' && next !== 'fold') {
				commit(next)
				return
			}
			guardSetup({
				agent: next,
				provider: getCodelayerProviderForLaunch(defaultProvider, useFoldCodingAgent),
				host: setupHost,
				onContinue: () => commit(next),
			})
		},
		[commit, defaultProvider, guardSetup, setupHost, useFoldCodingAgent],
	)

	return { onAgentChange }
}
