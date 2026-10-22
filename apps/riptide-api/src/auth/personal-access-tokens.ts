import { organizations } from '@humanlayer/db/tables/organizations'
import type { UserApiKey } from '@workos-inc/node'
import { eq } from 'drizzle-orm'
import { Data, Duration, Effect, Match, Redacted } from 'effect'

import type { PostgresDbQueryError } from '../effects/services/postgres/postgres-db.errors'
import { PostgresDb } from '../effects/services/postgres/postgres-db.service'
import type { WorkosError } from '../effects/services/workos/workos.errors'
import { WorkosService } from '../effects/services/workos/workos.service'
import type { AuthContext } from './jwt-validator'

export type PersonalAccessTokenExpiryDays = 7 | 14 | 30 | 60 | 90

export type PersonalAccessToken = Pick<
	UserApiKey,
	'id' | 'name' | 'obfuscatedValue' | 'createdAt' | 'expiresAt' | 'lastUsedAt'
>

type PersonalAccessTokenCreation = {
	readonly token: PersonalAccessToken
	readonly value: Redacted.Redacted<string>
}

export class PersonalAccessTokenNotFoundError extends Data.TaggedError('PersonalAccessTokenNotFoundError')<{
	id: string
}> {}

const projectPersonalAccessToken = (token: UserApiKey): PersonalAccessToken => ({
	id: token.id,
	name: token.name,
	obfuscatedValue: token.obfuscatedValue,
	createdAt: token.createdAt,
	expiresAt: token.expiresAt,
	lastUsedAt: token.lastUsedAt,
})

const personalAccessTokenExpiration = (expiresInDays: PersonalAccessTokenExpiryDays): Date =>
	new Date(Date.now() + Duration.toMillis(Duration.days(expiresInDays)))

export const createPersonalAccessToken = Effect.fn('auth.create_personal_access_token')(
	(input: {
		userId: string
		workosOrganizationId: string
		name: string
		expiresInDays: PersonalAccessTokenExpiryDays
	}): Effect.Effect<PersonalAccessTokenCreation, WorkosError, WorkosService> =>
		Effect.gen(function* () {
			const workos = yield* WorkosService
			const created = yield* workos.createUserApiKey({
				userId: input.userId,
				workosOrganizationId: input.workosOrganizationId,
				name: input.name,
				expiresAt: personalAccessTokenExpiration(input.expiresInDays),
			})

			return { token: projectPersonalAccessToken(created), value: Redacted.make(created.value) }
		}),
)

export const listPersonalAccessTokens = Effect.fn('auth.list_personal_access_tokens')(
	(input: {
		userId: string
		workosOrganizationId: string
	}): Effect.Effect<ReadonlyArray<PersonalAccessToken>, WorkosError, WorkosService> =>
		Effect.gen(function* () {
			const workos = yield* WorkosService
			const tokens = yield* workos.listUserApiKeys(input)
			return tokens.map(projectPersonalAccessToken)
		}),
)

export const revokePersonalAccessToken = Effect.fn('auth.revoke_personal_access_token')(
	(input: {
		userId: string
		workosOrganizationId: string
		id: string
	}): Effect.Effect<void, WorkosError | PersonalAccessTokenNotFoundError, WorkosService> =>
		Effect.gen(function* () {
			const workos = yield* WorkosService
			const tokens = yield* workos.listUserApiKeys(input)
			if (!tokens.some((token) => token.id === input.id)) {
				return yield* new PersonalAccessTokenNotFoundError({ id: input.id })
			}

			return yield* workos.deleteApiKey({ apiKeyId: input.id })
		}),
)

export const authenticatePersonalAccessToken = Effect.fn('auth.authenticate_personal_access_token')(
	(input: {
		value: string
	}): Effect.Effect<AuthContext | null, WorkosError | PostgresDbQueryError, WorkosService | PostgresDb> =>
		Effect.gen(function* () {
			const workos = yield* WorkosService
			const key = yield* workos.validateApiKey(input)
			if (key === null) return null

			const owner = Match.value(key.owner).pipe(
				Match.when({ type: 'user' }, (userOwner) => userOwner),
				Match.orElse(() => null),
			)
			if (owner === null) return null

			const postgres = yield* PostgresDb
			const [organization] = yield* postgres.query(
				postgres.client
					.select({ id: organizations.id })
					.from(organizations)
					.where(eq(organizations.workos_organization_id, owner.organizationId))
					.limit(1),
			)
			if (!organization) return null

			return {
				userId: owner.id,
				organizationId: organization.id,
				workosOrganizationId: owner.organizationId,
				role: 'member',
				roles: ['member'],
				permissions: [],
				entitlements: [],
			}
		}),
)
