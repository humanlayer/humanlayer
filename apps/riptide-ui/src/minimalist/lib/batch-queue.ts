import { useMutation } from '@tanstack/react-query'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

/**
 * Batch mode: when the agent finishes, send every queued message at once instead of one at a time.
 * It is the session owner's user setting, saved to the server; the switch moves first and moves back if the save fails.
 */
export function useBatchQueueDelivery(): { batch: boolean; setBatch: (batch: boolean) => void } {
	const { queryClient: api } = useRiptideApi()
	const { showToast } = useUi()
	const batch = useSettingsStore((state) => state.preferBatchQueueDelivery)
	const save = useMutation(
		api.auth.user.settings.update.mutationOptions({
			context: { silent: true },
			onSuccess: (data) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				useSettingsStore.getState().applyServerSettings(data)
			},
			onError: (_error, variables) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				if (variables.preferBatchQueueDelivery !== undefined)
					useSettingsStore.getState().setPreferBatchQueueDelivery(!variables.preferBatchQueueDelivery)
				showToast('Could not save batch mode. Try again.')
			},
		}),
	)
	return {
		batch,
		setBatch: (next) => {
			const store = useSettingsStore.getState()
			store.setPreferBatchQueueDelivery(next)
			store.markMutationInFlight()
			save.mutate({ preferBatchQueueDelivery: next })
		},
	}
}
