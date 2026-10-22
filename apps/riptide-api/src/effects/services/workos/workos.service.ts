import type { ApiKey, Invitation, UserApiKey, UserApiKeyWithValue } from '@workos-inc/node'
import { Context, Effect, Layer, Option } from 'effect'
import * as Schema from 'effect/Schema'

import type { WorkosSdkAdapter } from '../../../lib/workos-service'
import {
	WorkosClientError,
	type WorkosError,
	WorkosNetworkError,
	WorkosRateLimitError,
	WorkosServerError,
} from './workos.errors'

export type SendInvitationInput = {
	email: string
	organizationId: string
	inviterUserId?: string
	roleSlug?: string
	expiresInDays?: number
}

export type WorkosUserDisplay = {
	userId: string
	email: string
	firstName: string | null
	lastName: string | null
	avatarUrl?: string | null
}

export class WorkosService extends Context.Service<
	WorkosService,
	{
		listActiveAdmins: (input: {
			workosOrganizationId: string
		}) => Effect.Effect<Array<{ userId: string; email: string; firstName: string | null }>, WorkosError>
		sendInvitation: (input: SendInvitationInput) => Effect.Effect<Invitation, WorkosError>
		getUser: (input: { userId: string }) => Effect.Effect<WorkosUserDisplay, WorkosError>
		hasPendingInvitation: (input: {
			workosOrganizationId: string
			email: string
		}) => Effect.Effect<boolean, WorkosError>
		countActiveOrganizationMemberships: (workosOrganizationId: string) => Effect.Effect<number, WorkosError>
		countPendingInvitations: (input: { workosOrganizationId: string }) => Effect.Effect<number, WorkosError>
		/**
		 * List WorkOS users matching an email. Used by the access-request membership
		 * guardrail to resolve an anonymous requester's WorkOS user id from their email.
		 */
		listUsersByEmail: (input: { email: string }) => Effect.Effect<Array<WorkosUserDisplay>, WorkosError>
		/**
		 * List a user's ACTIVE memberships in a WorkOS organization. Used by the
		 * access-request membership guardrail to determine whether a requester is
		 * already an active member of the artifact's org. `limit` bounds the page size
		 * (the guardrail only needs to know whether at least one active membership exists).
		 */
		listActiveOrganizationMemberships: (input: {
			userId: string
			organizationId: string
			limit?: number
		}) => Effect.Effect<Array<{ userId: string; organizationId: string }>, WorkosError>
		createUserApiKey: (input: {
			userId: string
			workosOrganizationId: string
			name: string
			expiresAt: Date
		}) => Effect.Effect<UserApiKeyWithValue, WorkosError>
		listUserApiKeys: (input: {
			userId: string
			workosOrganizationId: string
		}) => Effect.Effect<ReadonlyArray<UserApiKey>, WorkosError>
		validateApiKey: (input: { value: string }) => Effect.Effect<ApiKey | null, WorkosError>
		deleteApiKey: (input: { apiKeyId: string }) => Effect.Effect<void, WorkosError>
	}
>()('WorkosService') {}

const WorkosHttpFailure = Schema.Struct({
	status: Schema.Number,
	retryAfter: Schema.optionalKey(Schema.NullOr(Schema.Number)),
})

interface WorkosHttpFailure extends Schema.Schema.Type<typeof WorkosHttpFailure> {}

function parseWorkosHttpFailure(cause: unknown): WorkosHttpFailure | undefined {
	return Option.getOrUndefined(Schema.decodeUnknownOption(WorkosHttpFailure)(cause))
}

function classifyWorkosError(cause: unknown): WorkosError {
	if (cause instanceof Error) {
		const msg = cause.message.toLowerCase()
		if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed')) {
			return new WorkosNetworkError({ cause })
		}
	}

	const httpFailure = parseWorkosHttpFailure(cause)
	if (httpFailure?.status === 429) {
		return new WorkosRateLimitError({
			cause,
			retryAfterMs:
				httpFailure.retryAfter === undefined || httpFailure.retryAfter === null
					? undefined
					: httpFailure.retryAfter * 1000,
		})
	}
	if (httpFailure && httpFailure.status >= 500) {
		return new WorkosServerError({ cause })
	}
	if (httpFailure) {
		return new WorkosClientError({ cause })
	}
	return new WorkosClientError({ cause })
}

export const makeWorkosServiceLive = (workos: WorkosSdkAdapter) =>
	Layer.effect(
		WorkosService,
		Effect.gen(function* () {
			return {
				listActiveAdmins: ({ workosOrganizationId }) =>
					Effect.tryPromise({
						try: async () => {
							const membershipsResult = await workos.userManagement.listOrganizationMemberships({
								organizationId: workosOrganizationId,
								statuses: ['active'],
							})
							const memberships = await membershipsResult.autoPagination()

							const adminMemberships = memberships.filter(
								(m) => m.role?.slug === 'admin' || m.role?.slug === 'manager',
							)

							const users = await Promise.all(
								adminMemberships.map(async (m) => {
									const user = await workos.userManagement.getUser(m.userId)
									return {
										userId: user.id,
										email: user.email,
										firstName: user.firstName ?? null,
									}
								}),
							)
							return users
						},
						catch: classifyWorkosError,
					}),

				sendInvitation: (input) =>
					Effect.tryPromise({
						try: () =>
							workos.userManagement.sendInvitation({
								email: input.email,
								organizationId: input.organizationId,
								inviterUserId: input.inviterUserId,
								roleSlug: input.roleSlug,
								expiresInDays: input.expiresInDays,
							}),
						catch: classifyWorkosError,
					}),

				getUser: ({ userId }) =>
					Effect.tryPromise({
						try: async () => {
							const user = await workos.userManagement.getUser(userId)
							return {
								userId: user.id,
								email: user.email,
								firstName: user.firstName ?? null,
								lastName: user.lastName ?? null,
								avatarUrl: user.profilePictureUrl ?? null,
							}
						},
						catch: classifyWorkosError,
					}),

				hasPendingInvitation: ({ workosOrganizationId, email }) =>
					Effect.tryPromise({
						try: async () => {
							const result = await workos.userManagement.listInvitations({
								organizationId: workosOrganizationId,
								email,
							})
							const invitations = await result.autoPagination()
							return invitations.some((invitation) => invitation.state === 'pending')
						},
						catch: classifyWorkosError,
					}),

				countActiveOrganizationMemberships: (workosOrganizationId) =>
					Effect.tryPromise({
						try: async () => {
							const result = await workos.userManagement.listOrganizationMemberships({
								organizationId: workosOrganizationId,
								statuses: ['active'],
							})
							const memberships = await result.autoPagination()
							return memberships.length
						},
						catch: classifyWorkosError,
					}),

				countPendingInvitations: ({ workosOrganizationId }) =>
					Effect.tryPromise({
						try: async () => {
							const result = await workos.userManagement.listInvitations({
								organizationId: workosOrganizationId,
							})
							const invitations = await result.autoPagination()
							return invitations.filter((invitation) => invitation.state === 'pending').length
						},
						catch: classifyWorkosError,
					}),

				listUsersByEmail: ({ email }) =>
					Effect.tryPromise({
						try: async () => {
							const result = await workos.userManagement.listUsers({ email })
							return result.data.map((user) => ({
								userId: user.id,
								email: user.email,
								firstName: user.firstName ?? null,
								lastName: user.lastName ?? null,
								avatarUrl: user.profilePictureUrl ?? null,
							}))
						},
						catch: classifyWorkosError,
					}),

				listActiveOrganizationMemberships: ({ userId, organizationId, limit }) =>
					Effect.tryPromise({
						try: async () => {
							const membershipInput: Parameters<
								typeof workos.userManagement.listOrganizationMemberships
							>[0] = {
								userId,
								organizationId,
								statuses: ['active'],
							}
							if (limit !== undefined) membershipInput.limit = limit
							const result = await workos.userManagement.listOrganizationMemberships(membershipInput)
							return result.data.map((membership) => ({
								userId: membership.userId,
								organizationId: membership.organizationId,
							}))
						},
						catch: classifyWorkosError,
					}),
				createUserApiKey: ({ userId, workosOrganizationId, name, expiresAt }) =>
					Effect.tryPromise({
						try: () =>
							workos.userManagement.createUserApiKey(userId, {
								organizationId: workosOrganizationId,
								name,
								expiresAt,
							}),
						catch: classifyWorkosError,
					}),
				listUserApiKeys: ({ userId, workosOrganizationId }) =>
					Effect.tryPromise({
						try: async () =>
							(
								await workos.userManagement.listUserApiKeys(userId, {
									organizationId: workosOrganizationId,
								})
							).autoPagination(),
						catch: classifyWorkosError,
					}),
				validateApiKey: ({ value }) =>
					Effect.tryPromise({
						try: async () => (await workos.apiKeys.createValidation({ value })).apiKey,
						catch: classifyWorkosError,
					}),
				deleteApiKey: ({ apiKeyId }) =>
					Effect.tryPromise({
						try: () => workos.apiKeys.deleteApiKey(apiKeyId),
						catch: classifyWorkosError,
					}),
			}
		}),
	)
