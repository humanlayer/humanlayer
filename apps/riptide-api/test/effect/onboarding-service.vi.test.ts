import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { vi } from 'vitest'

import { assignOnboardingSequence, fullSequencePercent } from '../../src/effects/services/onboarding/onboarding-config'
import { OnboardingProperties } from '../../src/effects/services/onboarding/onboarding-properties'
import { OnboardingService, OnboardingServiceLive } from '../../src/effects/services/onboarding/onboarding.service'
import { type EffectPostgresDbService, PostgresDb } from '../../src/effects/services/postgres/postgres-db.service'
import { ResendOperationError } from '../../src/effects/services/resend/resend-errors'
import {
	type ResendContact,
	ResendService,
	type ResendUpsertContactInput,
} from '../../src/effects/services/resend/resend.service'
import { WorkosServerError } from '../../src/effects/services/workos/workos.errors'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'

class FakeResendStore {
	contact: ResendContact | null = null
	upserts: Array<Pick<ResendUpsertContactInput, 'email' | 'properties' | 'segments'>> = []
	events: Array<{ event: string; email: string; payload?: Readonly<Record<string, unknown>> }> = []
	patches: Array<{ email: string; properties: Record<string, string> }> = []
	getFailures = 0
	upsertFailures = 0
	patchFailures = 0

	constructor(contact?: ResendContact | null) {
		this.contact = contact ?? null
	}
}

const resendOperationError = (retryable: boolean) =>
	new ResendOperationError({
		operation: 'test',
		category: retryable ? 'rate_limited' : 'invalid_request',
		retryable,
	})

function fakeResendLayer(store: FakeResendStore) {
	return Layer.succeed(ResendService, {
		sendPlaintext: () => Effect.fail(resendOperationError(false)),
		schedulePlaintext: () => Effect.fail(resendOperationError(false)),
		cancelScheduled: () => Effect.succeed(undefined),
		getContact: () => Effect.succeed(store.contact),
		upsertContact: (input) => {
			store.upserts.push(input)
			if (store.upsertFailures > 0) {
				store.upsertFailures--
				return Effect.fail(resendOperationError(true))
			}
			store.contact = { id: 'contact-1', email: input.email, properties: input.properties ?? {} }
			return Effect.succeed({ contactId: store.contact.id })
		},
		patchContactProperties: (input) => {
			store.patches.push({ email: input.email, properties: input.properties })
			if (store.patchFailures > 0) {
				store.patchFailures--
				return Effect.fail(resendOperationError(true))
			}
			return Effect.succeed({ contactId: 'contact-1' })
		},
		sendEvent: (input) => {
			store.events.push(input)
			return Effect.void
		},
	})
}

function fakeWorkosLayer(opts: { fail?: boolean } = {}) {
	return Layer.succeed(WorkosService, {
		...makeTestWorkosService(),
		listActiveAdmins: () => Effect.succeed([]),
		sendInvitation: () => Effect.fail(new WorkosServerError({ cause: new Error('not implemented') })),
		getUser: ({ userId }) =>
			opts.fail
				? Effect.fail(new WorkosServerError({ cause: new Error('workos failed') }))
				: Effect.succeed({ userId, email: `${userId}@example.com`, firstName: 'Ada', lastName: 'Lovelace' }),
		hasPendingInvitation: () => Effect.succeed(false),
		countActiveOrganizationMemberships: () => Effect.succeed(0),
		countPendingInvitations: () => Effect.succeed(0),
		listUsersByEmail: () => Effect.succeed([]),
		listActiveOrganizationMemberships: () => Effect.succeed([]),
	})
}

// Fake PostgresDb for milestone proof queries. The proof helpers run drizzle
// `select(...).from(table).where(...).limit(1)` chains inside `db.run(...)`; this
// fake records the requested table and returns store-driven rows, so tests drive
// the design-doc version count / design-discussion proof without a real DB.
interface FakePostgresState {
	// number of archived artifact_versions rows the version-count query returns
	versionCount: number
	// frontmatter/fileName the artifacts proof query returns; null means no artifact row
	artifactRow: { frontmatter: Record<string, unknown>; fileName: string } | null
}

// The proof helpers only ever await `.where(...).limit(1)`, so the chain just
// needs `from`/`where` to keep chaining and `limit` to resolve the configured rows.
function makeChainable(resolveRows: () => unknown[]) {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(resolveRows()),
	}
	return chain
}

function fakePostgresLayer(state: FakePostgresState) {
	const client = {
		select: (shape: Record<string, unknown>) => ({
			from: (_table: unknown) => {
				// Disambiguate the two proof queries by the selected column shape.
				if ('count' in shape) {
					return makeChainable(() => [{ count: state.versionCount }])
				}
				return makeChainable(() => (state.artifactRow ? [state.artifactRow] : []))
			},
		}),
	}
	const service: EffectPostgresDbService = {
		client: client as unknown as EffectPostgresDbService['client'],
		query: (q) => Effect.promise(() => Promise.resolve(q as unknown as Promise<unknown>)) as never,
		run: (fn) => Effect.promise(fn),
		transaction: (() => Effect.die('transaction not implemented in fake')) as never,
	}
	return Layer.succeed(PostgresDb, service)
}

// Onboarding config now resolves through Effect's ConfigProvider at layer
// construction time, so tests inject a deterministic provider instead of
// relying on process environment variables. Campaign disabled + 100% welcome
// keeps the asserted `onboarding__disabled` and sequence values stable.
const onboardingConfigLayer = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		ONBOARDING_CAMPAIGN_ENABLED: 'false',
		ONBOARDING_WELCOME_ONLY_PERCENT: '100',
		ONBOARDING_LITE_PERCENT: '0',
		RESEND_PRODUCT_USERS_SEGMENT_ID: 'segment-product-users',
	}),
)

function layer(store: FakeResendStore, opts: { workosFail?: boolean; postgres?: Partial<FakePostgresState> } = {}) {
	const postgresState: FakePostgresState = {
		versionCount: opts.postgres?.versionCount ?? 0,
		artifactRow: opts.postgres?.artifactRow ?? null,
	}
	return OnboardingServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				fakeResendLayer(store),
				fakeWorkosLayer({ fail: opts.workosFail }),
				onboardingConfigLayer,
				fakePostgresLayer(postgresState),
			),
		),
	)
}

describe('OnboardingService.enrollMember', () => {
	it.effect('writes initial properties and fires onboarding.started', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.enrollMember({ userId: 'user-1', organizationId: 'org-1' })

			expect(store.upserts).toHaveLength(1)
			const properties = store.upserts[0]?.properties ?? {}
			expect(properties[OnboardingProperties.workosUserId]).toBe('user-1')
			expect(properties[OnboardingProperties.sequence]).toBe('onboarding_v1_welcome_only')
			expect(properties[OnboardingProperties.disabled]).toBe('1')
			expect(properties[OnboardingProperties.isAdmin]).toBe('1')
			expect(properties[OnboardingProperties.enrolledAt]).toBeDefined()
			expect(store.upserts[0]?.segments).toEqual([{ id: 'segment-product-users' }])
			expect(store.events).toHaveLength(1)
			expect(store.events[0]?.event).toBe('onboarding.started')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('skips duplicate enrollment when the contact has onboarding__enrolled_at', ({ expect }) => {
		const store = new FakeResendStore({
			id: 'contact-1',
			email: 'user-1@example.com',
			properties: { [OnboardingProperties.enrolledAt]: '2026-01-01T00:00:00.000Z' },
		})
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.enrollMember({ userId: 'user-1', organizationId: 'org-1' })
			expect(store.upserts).toHaveLength(0)
			expect(store.events).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('wraps WorkOS profile lookup failures', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			const exit = yield* Effect.exit(svc.enrollMember({ userId: 'user-1', organizationId: 'org-1' }))
			expect(exit._tag).toBe('Failure')
			expect(store.upserts).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { workosFail: true })))
	})
})

describe('assignOnboardingSequence distribution boundaries', () => {
	it('full is the computed remainder of welcome-only + lite', ({ expect }) => {
		expect(fullSequencePercent({ welcomeOnlyPercent: 10, litePercent: 10 })).toBe(80)
		expect(fullSequencePercent({ welcomeOnlyPercent: 0, litePercent: 0 })).toBe(100)
		expect(fullSequencePercent({ welcomeOnlyPercent: 100, litePercent: 0 })).toBe(0)
	})

	it('rolls welcome-only when the random draw lands in the welcome-only band', ({ expect }) => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.05) // roll = 5 < 10
		try {
			expect(assignOnboardingSequence({ welcomeOnlyPercent: 10, litePercent: 10 })).toBe(
				'onboarding_v1_welcome_only',
			)
		} finally {
			spy.mockRestore()
		}
	})

	it('rolls lite when the draw lands between welcome-only and welcome-only+lite', ({ expect }) => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.15) // roll = 15, in [10,20)
		try {
			expect(assignOnboardingSequence({ welcomeOnlyPercent: 10, litePercent: 10 })).toBe('onboarding_v1_lite')
		} finally {
			spy.mockRestore()
		}
	})

	it('rolls full when the draw lands above welcome-only+lite', ({ expect }) => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // roll = 50 >= 20
		try {
			expect(assignOnboardingSequence({ welcomeOnlyPercent: 10, litePercent: 10 })).toBe('onboarding_v1_full')
		} finally {
			spy.mockRestore()
		}
	})

	it('0/0/100 always assigns full', ({ expect }) => {
		for (const r of [0, 0.25, 0.5, 0.99]) {
			const spy = vi.spyOn(Math, 'random').mockReturnValue(r)
			try {
				expect(assignOnboardingSequence({ welcomeOnlyPercent: 0, litePercent: 0 })).toBe('onboarding_v1_full')
			} finally {
				spy.mockRestore()
			}
		}
	})
})

describe('OnboardingService.recordRpiTaskCreated', () => {
	it.effect('patches onboarding__rpi_task_created for a launched RPI task', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordRpiTaskCreated({
				userId: 'user-1',
				taskId: 'task-1',
				workflowType: 'rpi',
				isDraft: false,
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.rpiTaskCreated]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	// The composer stores `outline_only` for its "RPI" selection and `prd_tdd` is
	// the other structured workflow — both earn the milestone, not just `rpi`.
	for (const workflowType of ['outline_only', 'prd_tdd'] as const) {
		it.effect(`patches onboarding__rpi_task_created for a launched ${workflowType} task`, ({ expect }) => {
			const store = new FakeResendStore()
			return Effect.gen(function* () {
				const svc = yield* OnboardingService
				yield* svc.recordRpiTaskCreated({ userId: 'user-1', taskId: 'task-1', workflowType, isDraft: false })
				expect(store.patches).toHaveLength(1)
				expect(store.patches[0]?.properties[OnboardingProperties.rpiTaskCreated]).toBe('1')
			}).pipe(Effect.provide(layer(store)))
		})
	}

	it.effect('no-ops for a draft RPI task', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordRpiTaskCreated({ userId: 'user-1', taskId: 'task-1', workflowType: 'rpi', isDraft: true })
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops for an unstructured workflow type', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordRpiTaskCreated({
				userId: 'user-1',
				taskId: 'task-1',
				workflowType: 'freeform',
				isDraft: false,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('is duplicate-safe: a second call patches "1" again without error', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			const input = { userId: 'user-1', taskId: 'task-1', workflowType: 'rpi' as const, isDraft: false }
			yield* svc.recordRpiTaskCreated(input)
			yield* svc.recordRpiTaskCreated(input)
			expect(store.patches).toHaveLength(2)
			expect(store.patches.every((p) => p.properties[OnboardingProperties.rpiTaskCreated] === '1')).toBe(true)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('falls back to upsertContact when patchContactProperties returns resource_missing', ({ expect }) => {
		const store = new FakeResendStore()
		const resourceMissing = new ResendOperationError({
			operation: 'patch_contact_properties',
			category: 'resource_missing',
			retryable: false,
			message: 'Contact not found',
		})
		const resendLayer = Layer.succeed(ResendService, {
			sendPlaintext: () => Effect.fail(resendOperationError(false)),
			schedulePlaintext: () => Effect.fail(resendOperationError(false)),
			cancelScheduled: () => Effect.succeed(undefined),
			getContact: () => Effect.succeed(store.contact),
			upsertContact: (input) => {
				store.upserts.push(input)
				store.contact = { id: 'contact-1', email: input.email, properties: input.properties ?? {} }
				return Effect.succeed({ contactId: store.contact.id })
			},
			patchContactProperties: () => Effect.fail(resourceMissing),
			sendEvent: (input) => {
				store.events.push(input)
				return Effect.void
			},
		})
		const testLayer = OnboardingServiceLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					resendLayer,
					fakeWorkosLayer(),
					onboardingConfigLayer,
					fakePostgresLayer({ versionCount: 0, artifactRow: null }),
				),
			),
		)
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordRpiTaskCreated({
				userId: 'user-1',
				taskId: 'task-1',
				workflowType: 'rpi',
				isDraft: false,
			})
			expect(store.upserts).toHaveLength(1)
			expect(store.upserts[0]?.email).toBe('user-1@example.com')
			expect(store.upserts[0]?.properties?.[OnboardingProperties.rpiTaskCreated]).toBe('1')
		}).pipe(Effect.provide(testLayer))
	})

	// A transient Resend failure that the retry budget cannot recover surfaces as
	// a wrapped `MilestonePatchFailed` and never as a raw transport error — that
	// domain wrapping is what the detached caller logs/reports.
	it.effect('wraps an unrecoverable transient Resend failure as MilestonePatchFailed', ({ expect }) => {
		const store = new FakeResendStore()
		// Larger than any retry budget so the patch never succeeds.
		store.patchFailures = 100
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			const fiber = yield* Effect.exit(
				svc.recordRpiTaskCreated({
					userId: 'user-1',
					taskId: 'task-1',
					workflowType: 'rpi',
					isDraft: false,
				}),
			).pipe(Effect.forkChild({ startImmediately: true }))
			yield* TestClock.adjust('10 seconds')
			const exit = yield* Fiber.join(fiber)
			expect(exit._tag).toBe('Failure')
			if (Exit.isFailure(exit)) {
				const failure = exit.cause.toString()
				expect(failure).toContain('MilestonePatchFailed')
			}
		}).pipe(Effect.provide(layer(store)))
	})
})

describe('OnboardingService.recordTrackerConnected', () => {
	it.effect('patches onboarding__tracker_connected on successful connection', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordTrackerConnected({
				userId: 'user-1',
				organizationId: 'org-1',
				provider: 'linear',
				integrationId: 'org-1',
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.trackerConnected]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('patches for jira just the same', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordTrackerConnected({
				userId: 'user-1',
				organizationId: 'org-1',
				provider: 'jira',
				integrationId: 'org-1',
			})
			expect(store.patches[0]?.properties[OnboardingProperties.trackerConnected]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})
})

const DESIGN_DOC_ROW = { frontmatter: { type: 'design-discussion' }, fileName: '02-design-discussion.md' }

describe('OnboardingService.recordDesignDocIterated', () => {
	it.effect('patches design_doc_iterated when versionNumber proves >=2 versions', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocIterated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '02-design-discussion.md',
				frontmatterType: 'design-discussion',
				versionNumber: 1,
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.designDocIterated]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('patches when the proof query shows >=1 archived version', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			// No versionNumber short-circuit: the query reports 1 archived version
			// (current + 1 archived = 2 states), which meets the >=2-version bar.
			yield* svc.recordDesignDocIterated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '02-design-discussion.md',
				frontmatterType: 'design-discussion',
			})
			expect(store.patches).toHaveLength(1)
		}).pipe(Effect.provide(layer(store, { postgres: { versionCount: 1 } })))
	})

	it.effect('no-ops when the doc has not been iterated (no archived versions)', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocIterated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '02-design-discussion.md',
				frontmatterType: 'design-discussion',
				versionNumber: 0,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { versionCount: 0 } })))
	})

	it.effect('no-ops for a non-design artifact even when iterated', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocIterated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '04-structure-outline.md',
				frontmatterType: 'structure-outline',
				versionNumber: 5,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { versionCount: 5 } })))
	})
})

describe('OnboardingService.recordDesignDocInboundCommentReceived', () => {
	it.effect('patches received when a different human comments on a design doc', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentReceived({
				ownerUserId: 'owner-1',
				commenterUserId: 'commenter-2',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: false,
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.designDocInboundCommentReceived]).toBe('1')
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: DESIGN_DOC_ROW } })))
	})

	it.effect('no-ops for an agent-authored comment', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentReceived({
				ownerUserId: 'owner-1',
				commenterUserId: 'commenter-2',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: true,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: DESIGN_DOC_ROW } })))
	})

	it.effect('no-ops when the owner comments on their own doc', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentReceived({
				ownerUserId: 'owner-1',
				commenterUserId: 'owner-1',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: false,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: DESIGN_DOC_ROW } })))
	})

	it.effect('no-ops when the commented-on artifact is not a design discussion', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentReceived({
				ownerUserId: 'owner-1',
				commenterUserId: 'commenter-2',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: false,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(
			Effect.provide(
				layer(store, {
					postgres: { artifactRow: { frontmatter: { type: 'structure-outline' }, fileName: 'outline.md' } },
				}),
			),
		)
	})
})

describe('OnboardingService.recordDesignDocInboundCommentResolved', () => {
	it.effect('patches resolved when a design-doc thread is resolved', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentResolved({
				ownerUserId: 'owner-1',
				resolverUserId: 'owner-1',
				commentId: 'comment-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				isResolved: true,
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.designDocInboundCommentResolved]).toBe('1')
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: DESIGN_DOC_ROW } })))
	})

	it.effect('no-ops when isResolved is false (unresolve transition)', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentResolved({
				ownerUserId: 'owner-1',
				resolverUserId: 'owner-1',
				commentId: 'comment-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				isResolved: false,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: DESIGN_DOC_ROW } })))
	})

	it.effect('no-ops when the resolved artifact is not a design discussion', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordDesignDocInboundCommentResolved({
				ownerUserId: 'owner-1',
				resolverUserId: 'owner-1',
				commentId: 'comment-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				isResolved: true,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store, { postgres: { artifactRow: null } })))
	})
})

describe('OnboardingService.recordStructureOutlineCreated', () => {
	it.effect('patches structure_outline_created for a structure-outline artifact', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordStructureOutlineCreated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '04-structure-outline.md',
				frontmatterType: 'structure-outline',
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.structureOutlineCreated]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('matches on filename when frontmatter type is absent', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordStructureOutlineCreated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '06-structure-outline-drip.md',
			})
			expect(store.patches).toHaveLength(1)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops for a non-structure-outline artifact', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordStructureOutlineCreated({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '02-design-discussion.md',
				frontmatterType: 'design-discussion',
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})
})

describe('OnboardingService.recordImplementationStarted', () => {
	it.effect('patches implementation_started for a single implementation label', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationStarted({
				userId: 'user-1',
				sessionId: 'session-1',
				taskId: 'task-1',
				label: { name: 'rpi:implementation', title: 'implementation' },
				source: 'auto_advance',
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.implementationStarted]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('patches when the implementation label is in a labels array', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationStarted({
				userId: 'user-1',
				sessionId: 'session-1',
				taskId: 'task-1',
				labels: [
					{ name: 'rpi:worktree-setup', title: 'worktree-setup' },
					{ name: 'rpi:implementation', title: 'implementation' },
				],
				source: 'daemon_event_label',
			})
			expect(store.patches).toHaveLength(1)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops for a non-implementation label', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationStarted({
				userId: 'user-1',
				sessionId: 'session-1',
				taskId: 'task-1',
				label: { name: 'rpi:design', title: 'design' },
				source: 'daemon_event_label',
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops when no labels are supplied', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationStarted({
				userId: 'user-1',
				sessionId: 'session-1',
				taskId: 'task-1',
				source: 'auto_advance',
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})
})

describe('OnboardingService.recordImplementationComplete', () => {
	it.effect('patches implementation_complete for a pr-description artifact', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationComplete({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: 'pr-description.md',
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.implementationComplete]).toBe('1')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops for a non-pr-description artifact', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordImplementationComplete({
				resourceOwnerUserId: 'owner-1',
				artifactId: 'artifact-1',
				taskId: 'task-1',
				fileName: '04-structure-outline.md',
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})
})

describe('OnboardingService.recordCommentedOnTeammateDoc', () => {
	it.effect('patches commented_on_teammate_doc for the commenter on a teammate doc', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordCommentedOnTeammateDoc({
				ownerUserId: 'owner-1',
				commenterUserId: 'commenter-2',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: false,
			})
			expect(store.patches).toHaveLength(1)
			expect(store.patches[0]?.properties[OnboardingProperties.commentedOnTeammateDoc]).toBe('1')
			// The COMMENTER is the one progressing, so their contact is patched (not the owner).
			expect(store.patches[0]?.email).toBe('commenter-2@example.com')
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops when the commenter is the owner (self-comment)', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordCommentedOnTeammateDoc({
				ownerUserId: 'owner-1',
				commenterUserId: 'owner-1',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: false,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})

	it.effect('no-ops for an agent-authored comment', ({ expect }) => {
		const store = new FakeResendStore()
		return Effect.gen(function* () {
			const svc = yield* OnboardingService
			yield* svc.recordCommentedOnTeammateDoc({
				ownerUserId: 'owner-1',
				commenterUserId: 'commenter-2',
				artifactId: 'artifact-1',
				commentId: 'comment-1',
				taskId: 'task-1',
				createdByAgent: true,
			})
			expect(store.patches).toHaveLength(0)
		}).pipe(Effect.provide(layer(store)))
	})
})
