import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRiptideApi } from '@/orpc/client'

/** Reuse the existing server preference; clearing it reopens onboarding without resetting milestones. */
export function useDismissOnboardingAction() {
	const { queryClient: api } = useRiptideApi()
	const { mutate } = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onMutate: (input) => {
				const settings = useSettingsStore.getState()
				const previous = settings.onboardingDismissedAt
				settings.setOnboardingDismissedAt(input.onboardingDismissedAt ?? null)
				settings.markMutationInFlight()
				return { previous }
			},
			onSuccess: (data) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				useSettingsStore.getState().applyServerSettings(data)
			},
			onError: (_error, _input, context) => {
				useSettingsStore.setState({ onboardingDismissedAt: context?.previous ?? null, _lastMutationAt: 0 })
				toast.error('Could not save onboarding preference. Please try again.')
			},
		}),
	)

	return useCallback(
		(dismissed = true) => {
			const dismissedAt = dismissed ? Date.now() : null
			mutate({ onboardingDismissedAt: dismissedAt })
		},
		[mutate],
	)
}
