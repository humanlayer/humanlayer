import type { SelectableModelProvider } from '@humanlayer/schemas/model-provider'
import { useCallback } from 'react'

import { useCodingAgentSetupStore } from '@/hooks/stores/codingAgentSetupStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentAuthService } from '@/hooks/use-coding-agent-auth'
import {
	getCodingAgentSetupTarget,
	isCodingAgentSetupAcknowledged,
	type CodingAgentSetupHost,
} from '@/lib/coding-agent-setup'

export function useCodingAgentSetupGuard() {
	const acknowledgements = useSettingsStore((state) => state.codingAgentSetupAcknowledgements)
	const openSetup = useCodingAgentSetupStore((state) => state.open)
	const auth = useCodingAgentAuthService()

	const guardSetup = useCallback(
		(input: {
			readonly agent: 'codelayer' | 'fold'
			readonly provider: SelectableModelProvider
			readonly host: CodingAgentSetupHost | null
			readonly onContinue: () => void
			readonly onCancel?: () => void
		}) => {
			const target = getCodingAgentSetupTarget(input)
			if (
				!target ||
				isCodingAgentSetupAcknowledged(acknowledgements, target) ||
				(target.variant.signInProvider !== null &&
					auth.getState(target.host, target.variant.signInProvider, target.variant.agent) !== 'unknown')
			) {
				input.onContinue()
				return
			}
			openSetup({ target, onContinue: input.onContinue, onCancel: input.onCancel })
		},
		[acknowledgements, openSetup, auth],
	)

	return { guardSetup }
}
