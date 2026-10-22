import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'

import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

export type UpdateMultiplayerPromptingParams = RiptideApiInputs['sessions']['multiplayerPrompting']['update']

export function createMultiplayerPromptingActions(
	api: Pick<RiptideApiClient, 'sessions'>,
	sessionsConfirmTx: ConfirmTxFn,
) {
	const update = async (params: UpdateMultiplayerPromptingParams) => {
		const response = await api.sessions.multiplayerPrompting.update(params)
		await sessionsConfirmTx(response.transactionId)
		return response
	}

	return { update }
}
