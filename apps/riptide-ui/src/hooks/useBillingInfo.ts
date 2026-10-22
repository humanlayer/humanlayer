import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useRiptideApi } from '@/orpc/client'

interface UseBillingInfoOptions {
	enabled?: boolean
}

export function useBillingInfo(options: UseBillingInfoOptions = {}) {
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const { roles, isLoading: isAuthLoading } = useAuth()
	const { enabled = true } = options
	const isOrgAdmin = roles?.includes('admin') || false

	const billingInfoQuery = useQuery(
		api.auth.admin.billing.info.queryOptions({
			input: {},
			enabled: enabled && isOrgAdmin,
			refetchInterval: 60_000,
			retry: false,
		}),
	)

	const createCheckoutSession = useMutation(api.billing.createCheckoutSession.mutationOptions({}))

	const createPortalSession = useMutation(api.billing.createPortalSession.mutationOptions({}))

	const startUpgrade = useMutation(api.billing.startUpgrade.mutationOptions({}))

	const downgradeToStarter = useMutation(
		api.billing.downgradeToStarter.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
			},
		}),
	)

	const syncCheckoutSession = useMutation(
		api.billing.syncCheckoutSession.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
			},
		}),
	)

	const resyncSeats = useMutation(
		api.billing.resyncSeats.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
			},
		}),
	)

	const applyPromotionCode = useMutation(
		api.billing.applyPromotionCode.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
			},
		}),
	)

	return {
		...billingInfoQuery,
		isOrgAdmin,
		isUserInfoLoading: isAuthLoading,
		createCheckoutSession,
		createPortalSession,
		startUpgrade,
		downgradeToStarter,
		resyncSeats,
		syncCheckoutSession,
		applyPromotionCode,
	}
}
