import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { DaemonIdentity, DaemonLeaseIdentity, DaemonLockOwner } from '../src/effect/daemon/identity'

describe('daemon identity schemas', () => {
	it.effect('composes identity, lease identity, and encoded lock owner records', () =>
		Effect.gen(function* () {
			const encodedIdentity: unknown = {
				userId: 'user-1',
				organizationId: 'organization-1',
				hostId: 'host-1',
			}
			const identity = yield* Schema.decodeUnknownEffect(DaemonIdentity)(encodedIdentity)
			const encodedLeaseIdentity: unknown = {
				...identity,
				stage: 'dev',
			}
			const leaseIdentity = yield* Schema.decodeUnknownEffect(DaemonLeaseIdentity)(encodedLeaseIdentity)
			const encodedOwner: unknown = {
				pid: 123,
				...leaseIdentity,
				generationId: null,
			}
			expect(yield* Schema.decodeUnknownEffect(DaemonLockOwner)(encodedOwner)).toEqual({
				pid: 123,
				...leaseIdentity,
				generationId: null,
			})
		}),
	)

	it.effect('requires every owner key and preserves nullable generation semantics', () =>
		Effect.gen(function* () {
			const baseOwner = {
				pid: 123,
				userId: 'user-1',
				organizationId: 'organization-1',
				hostId: 'host-1',
				stage: 'prod',
			}

			for (const owner of [baseOwner, { ...baseOwner, generationId: undefined }]) {
				expect((yield* Effect.exit(Schema.decodeUnknownEffect(DaemonLockOwner)(owner)))._tag).toBe('Failure')
			}
			expect(
				yield* Schema.decodeUnknownEffect(DaemonLockOwner)({ ...baseOwner, generationId: 'generation-1' }),
			).toMatchObject({ generationId: 'generation-1' })
		}),
	)

	it.effect('rejects empty daemon identity fields', () =>
		Effect.gen(function* () {
			const identity = {
				userId: 'user-1',
				organizationId: 'organization-1',
				hostId: 'host-1',
			}

			for (const field of ['userId', 'organizationId', 'hostId'] as const) {
				expect(
					(yield* Effect.exit(Schema.decodeUnknownEffect(DaemonIdentity)({ ...identity, [field]: '' })))._tag,
				).toBe('Failure')
			}
		}),
	)

	it.effect('rejects invalid lock owner process and generation identifiers', () =>
		Effect.gen(function* () {
			const owner = {
				pid: 123,
				userId: 'user-1',
				organizationId: 'organization-1',
				hostId: 'host-1',
				stage: 'prod',
				generationId: null,
			}

			for (const pid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
				expect((yield* Effect.exit(Schema.decodeUnknownEffect(DaemonLockOwner)({ ...owner, pid })))._tag).toBe(
					'Failure',
				)
			}
			expect(
				(yield* Effect.exit(Schema.decodeUnknownEffect(DaemonLockOwner)({ ...owner, generationId: '' })))._tag,
			).toBe('Failure')
		}),
	)
})
