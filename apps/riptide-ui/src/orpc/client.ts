import { RiptideApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { ORPCError, createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import * as Sentry from '@sentry/react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { showBillingRequiredToast } from '@/lib/billing-required-toast'
import { logger } from '@/lib/logger'
import type { NavigateFn } from '@/lib/settings-navigation'

/** Type alias for the Riptide API client */
export type RiptideApiClient = JsonifiedClient<ContractRouterClient<typeof RiptideApiContract>>

/**
 * Default API origin for local development
 */
const DEFAULT_API_ORIGIN = 'http://localhost:8700'

export const riptideApiOrigin = import.meta.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN || DEFAULT_API_ORIGIN

function getDefinedErrorDataMessage(error: { data?: unknown; message?: string }): string | undefined {
	if (!error.data || typeof error.data !== 'object') return undefined
	const message = (error.data as { message?: unknown }).message
	if (typeof message !== 'string' || message.trim().length === 0) return undefined
	if (message === error.message) return undefined
	return message
}

interface RiptideApiErrorOptions {
	context?: { silent?: boolean }
}

interface RiptideApiErrorDependencies {
	navigate: NavigateFn
	isOnOrgPages: boolean
	roles: readonly string[] | null | undefined
}

export function handleRiptideApiError(
	error: ORPCError<string, unknown>,
	options: RiptideApiErrorOptions | undefined,
	{ navigate, isOnOrgPages, roles }: RiptideApiErrorDependencies,
): void {
	if (options?.context?.silent) return

	logger.error(`Riptide API oRPC Client Error:`, error)
	const dataMessage = getDefinedErrorDataMessage(error)

	switch (error.code) {
		case 'UNAUTHORIZED':
			// A 401 also answers requests sent before sign-in finishes. Expired sessions go to sign-in through AuthKit's onRefreshFailure, or through AuthEnforcer at startup.
			break

		case 'ORGANIZATION_REQUIRED':
			if (!isOnOrgPages) {
				toast.info('Please select an organization to continue')
				navigate({ to: '/auth/organizations/select' })
			}
			break

		case 'BILLING_REQUIRED': {
			const isAdmin = roles?.includes('admin') ?? false
			showBillingRequiredToast(isAdmin, navigate)
			break
		}

		case 'TASK_SLUG_CONFLICT':
		case 'TASK_LAUNCH_CONFLICT':
			// Only the task composers call tasks.create and tasks.launchDraft, and they show these messages themselves.
			break

		case 'FORBIDDEN':
			toast.error("You don't have permission to perform this action.", {
				description: dataMessage,
			})
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
			toast.error(error.message || 'An unexpected error occurred. Please try again.', {
				description: dataMessage,
			})
	}
}

interface RiptideApiInterceptorOptions extends RiptideApiErrorOptions {
	next: () => Promise<unknown>
}

export function createRiptideApiErrorInterceptor(
	dependencies: RiptideApiErrorDependencies,
): (options: RiptideApiInterceptorOptions) => Promise<unknown> {
	return async (options) => {
		try {
			return await options.next()
		} catch (error) {
			if (options.context?.silent || !(error instanceof ORPCError) || !error.defined) throw error
			handleRiptideApiError(error, options, dependencies)
			throw error
		}
	}
}

/**
 * Hook that creates oRPC clients for the Riptide API.
 *
 * Returns:
 * - `client` - Raw oRPC client for direct API calls: `client.sessions.update(input)`
 * - `queryClient` - TanStack Query wrapped client for hooks: `queryClient.sessions.update.queryOptions()`
 *
 * IMPORTANT! This hook MUST be used under the `<AuthProvider>` since it uses useAuth
 *
 * @example
 * ```tsx
 * const { client, queryClient } = useRiptideApi()
 *
 * // Direct API call (for optimistic actions)
 * await client.sessions.update({ sessionId, title })
 *
 * // TanStack Query hook
 * const { data } = useQuery(queryClient.auth.user.organizations.list.queryOptions({}))
 * ```
 */
export function useRiptideApi() {
	const { getAccessToken, user, organizationId, roles } = useAuth()
	const navigate = useNavigate()
	const pathname = useLocation({ select: (loc) => loc.pathname })
	const isOnOrgPages = pathname.includes('auth/organizations')

	const { client, queryClient } = useMemo(() => {
		const link = new OpenAPILink(RiptideApiContract, {
			url: `${riptideApiOrigin}/rpc/api/v1`,
			headers: async () => {
				if (!user) return {}
				const accessToken = await getAccessToken()
				return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
			},
			interceptors: [createRiptideApiErrorInterceptor({ navigate, isOnOrgPages, roles })],
		})

		// Raw client for direct API calls
		const client: JsonifiedClient<ContractRouterClient<typeof RiptideApiContract>> = createORPCClient(link)

		// TanStack Query wrapped client for hooks
		const queryClient = createTanstackQueryUtils(client)

		return { client, queryClient }
	}, [getAccessToken, user, user?.id, organizationId, isOnOrgPages, roles])

	const authScope = { userId: user?.id ?? null, organizationId: organizationId ?? null }

	return { client, queryClient, authScope }
}
