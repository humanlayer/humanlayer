import * as Sentry from '@sentry/node'
import { Effect } from 'effect'
import { decodeJwt } from 'jose'

import type { AppRuntime } from '../effects/app-runtime'
import logger from '../logger'
import { validateDaemonToken } from './daemon-tokens'
import { type AuthContextOptionalOrg, validateJWT } from './jwt-validator'
import { authenticatePersonalAccessToken } from './personal-access-tokens'

export const resolveUserAuthContext = Effect.fn('auth.resolve_user_auth_context')(function* (input: {
	authorizationHeader: string | null
}) {
	const match = input.authorizationHeader?.match(/^Bearer (.+)$/)
	if (!match?.[1]) return null
	const credential = match[1]
	if (isJwtCredential(credential)) {
		return yield* Effect.promise(() => validateJWT(credential))
	}
	return yield* authenticatePersonalAccessToken({ value: credential })
})

function isJwtCredential(credential: string): boolean {
	try {
		decodeJwt(credential)
		return true
	} catch {
		return false
	}
}

export async function getAuthContext(req: Request, runtime: AppRuntime): Promise<AuthContextOptionalOrg | null> {
	try {
		const authHeader = req.headers.get('authorization')
		if (!authHeader) {
			logger.warn('Missing authorization header')
			return null
		}
		return await runtime.runPromise(resolveUserAuthContext({ authorizationHeader: authHeader }))
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'auth_failure' },
		})
		logger.error(error, 'Error getting auth context')
		throw error
	}
}

export type DaemonAuthContext = {
	userId: string
	organizationId: string
	hostId: string
}

export async function getDaemonAuthContext(req: Request): Promise<DaemonAuthContext | null> {
	const daemonAuthHeader = req.headers.get('x-daemon-authorization')
	if (!daemonAuthHeader) {
		logger.warn('Missing daemon authorization header')
		return null
	}

	try {
		const validated = await validateDaemonToken(daemonAuthHeader)
		if (!validated) {
			logger.warn('Invalid daemon token')
			return null
		}

		return {
			userId: validated.userId,
			organizationId: validated.organizationId,
			hostId: validated.hostId,
		}
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'auth_failure' },
		})
		logger.error('Error validating daemon token', { error })
		return null
	}
}
