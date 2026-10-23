import { RiptideApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { createORPCClient, onError, ORPCError } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import * as Sentry from '@sentry/react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { env } from '@/env'
import { showBillingRequiredToast } from '@/lib/billing-required-toast'

export function createApiClient(
	getAccessToken?: () => Promise<string>,
	signOut?: () => void,
	navigate?: (opts: { to: string }) => void,
	roles?: string[],
) {
	const link = new OpenAPILink(RiptideApiContract, {
		url: `${env.VITE_PUBLIC_RIPTIDE_API_ORIGIN}/rpc/api/v1`,
		headers: async () => {
			if (getAccessToken) {
				const token = await getAccessToken().catch(() => null)
				if (token) return { Authorization: `Bearer ${token}` }
			}
			return {}
		},
		interceptors: [
			onError((error) => {
				if (!(error instanceof ORPCError) || !error.defined) return

				console.error('Riptide API oRPC Client Error:', error)

				switch (error.code) {
					case 'UNAUTHORIZED':
						toast.warning('Your session has expired. Please sign in again.')
						if (signOut && navigate) {
							setTimeout(() => {
								signOut()
								navigate({ to: '/auth/signin' })
							}, 2000)
						}
						break

					case 'ORGANIZATION_REQUIRED':
						toast.info('Please select an organization to continue')
						if (navigate) {
							navigate({ to: '/organizations/select' })
						}
						break

					case 'BILLING_REQUIRED': {
						const isAdmin = roles?.includes('admin') ?? false
						showBillingRequiredToast(isAdmin, navigate)
						break
					}

					case 'FORBIDDEN':
						toast.error("You don't have permission to perform this action.")
						break

					case 'ALREADY_A_MEMBER':
						toast.warning(error.message || 'This user is already a member of the organization')
						break

					case 'ALREADY_INVITED':
						toast.warning(error.message || 'This user has already been invited')
						break

					case 'INPUT_VALIDATION_FAILED': {
						Sentry.captureException(error, {
							tags: { error_type: 'validation_error' },
							extra: { validation_errors: error.data },
						})
						const validationMessage = error.message || 'Please check your input and try again.'
						toast.error(`Validation error: ${validationMessage}`)
						break
					}

					case 'INVALID_PROMO_CODE':
						toast.error('This promo code is not valid.')
						break

					case 'NETWORK_ERROR':
						toast.error('Connection issue. Please check your internet connection.')
						break

					case 'SERVER_ERROR':
					case 'INTERNAL_SERVER_ERROR':
						Sentry.captureException(error, {
							tags: { error_type: 'internal_server_error' },
							extra: { error_data: error.data },
						})
						toast.error('Something went wrong on our end. Please try again later.')
						break

					default:
						if (!['NETWORK_ERROR', 'FORBIDDEN', 'UNAUTHORIZED'].includes(error.code)) {
							Sentry.captureException(error, {
								tags: {
									error_type: 'unexpected_api_error',
									error_code: error.code,
								},
								extra: { error_data: error.data },
							})
						}
						toast.error(error.message || 'An unexpected error occurred. Please try again.')
				}
			}),
		],
	})

	const client: JsonifiedClient<ContractRouterClient<typeof RiptideApiContract>> = createORPCClient(link)
	const queryClient = createTanstackQueryUtils(client)

	return { client, queryClient }
}

/**
 * Hook to get authenticated API client with error interceptors.
 * Use this in components that need to make API calls.
 */
export function useRiptideApi() {
	const { getAccessToken, signOut, user, organizationId, roles } = useAuth()
	const navigate = useNavigate()

	const api = useMemo(() => {
		return createApiClient(user ? getAccessToken : undefined, signOut, navigate, roles ?? undefined)
	}, [getAccessToken, signOut, navigate, roles, user?.id, organizationId])

	const authScope = { userId: user?.id ?? null, organizationId: organizationId ?? null }

	return { ...api, authScope }
}

export type ApiClient = ReturnType<typeof createApiClient>
