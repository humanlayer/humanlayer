import { describe, expect, it } from 'vitest'

import { createLauncherV3DraftLifecycle } from '@/components/launcher-v3/drafts/useLauncherV3DraftController'

import {
	createLauncherV3DraftPersistence,
	importLauncherV3Draft,
	LEGACY_LAUNCHER_V3_ACTIVE_RECOVERY_KEY,
	LEGACY_LAUNCHER_V3_DRAFT_EXTRAS_PREFIX,
	launcherV3ActiveRecoveryKey,
	launcherV3DraftExtrasKey,
	recoveryFromDraft,
	type LauncherV3Storage,
} from './launcher-v3-drafts'
import { createLauncherV3DefaultValues, toPersistedLauncherV3Draft } from './launcher-v3-form'

const AUTH_SCOPE = { userId: 'user-1', organizationId: 'org-1' }

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial))
	const storage: LauncherV3Storage = {
		get length() {
			return values.size
		},
		key: (index) => [...values.keys()][index] ?? null,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	}
	return { storage, values }
}

function persistedValues() {
	return toPersistedLauncherV3Draft(
		createLauncherV3DefaultValues({
			prompt: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich prompt' }] }] },
			title: 'Draft title',
			slug: 'draft-title',
			hostId: 'host-1',
			directory: '/repo',
			permissionsMode: 'accept_edits',
			provider: 'copilot',
			model: 'sonnet',
			effort: 'high',
			fastMode: true,
		}),
	)
}

describe('Launcher V3 draft persistence', () => {
	it('round-trips enabled Freeform auto-advance through serialized extras', () => {
		const persisted = toPersistedLauncherV3Draft(
			createLauncherV3DefaultValues({ workflowType: 'freeform', autoAdvance: true, prompt: 'Build it' }),
		)
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		expect(persistence.writeExtras('freeform-draft', persisted.local)).toBe(true)
		expect(
			importLauncherV3Draft({
				draftRow: persisted.durable,
				localExtras: persistence.readExtras('freeform-draft'),
			}),
		).toEqual(createLauncherV3DefaultValues(persisted.local))
	})

	it('restores enabled Freeform auto-advance from the durable PR flag without extras', () => {
		expect(
			importLauncherV3Draft({
				draftRow: {
					workflow_type: 'freeform',
					auto_advance_questions_to_research: false,
					auto_advance_research_to_design: false,
					auto_advance_plan_to_worktree: false,
					auto_advance_worktree_to_implementation: false,
					auto_advance_implementation_to_pr: true,
				},
			}),
		).toMatchObject({ workflowType: 'freeform', autoAdvance: true })
	})

	it('persists one stable launch identity with its editing and launching state', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const identity = {
			draftId: 'draft-1',
			firstSessionId: 'session-1',
			firstEventId: 'event-1',
			state: 'editing' as const,
		}

		expect(persistence.writeLaunchIdentity(identity)).toBe(true)
		expect(persistence.readLaunchIdentity(identity.draftId)).toEqual(identity)
		expect(persistence.readLaunchIdentity('another-draft')).toBeNull()
	})

	it('uses versioned per-draft extras and restores a V3 draft', () => {
		const persisted = persistedValues()
		const { storage, values } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		expect(persistence.writeExtras('draft-1', persisted.local)).toBe(true)

		expect(JSON.parse(values.get(launcherV3DraftExtrasKey(AUTH_SCOPE, 'draft-1')) ?? '')).toEqual({
			version: 2,
			...AUTH_SCOPE,
			values: persisted.local,
		})
		expect(
			importLauncherV3Draft({
				draftRow: persisted.durable,
				localExtras: persistence.readExtras('draft-1'),
			}),
		).toEqual(createLauncherV3DefaultValues(persisted.local))
	})

	it('restores V2 row fields and fills absent values from current defaults', () => {
		const defaults = createLauncherV3DefaultValues({ hostId: 'current-host', model: 'current-model' })
		expect(
			importLauncherV3Draft({
				draftRow: {
					name: 'V2 draft',
					slug: 'v2-draft',
					default_working_directory: '/v2',
					ticket_description: 'Plain prompt',
				},
				defaults,
			}),
		).toMatchObject({
			title: 'V2 draft',
			slug: 'v2-draft',
			directory: '/v2',
			prompt: 'Plain prompt',
			hostId: 'current-host',
			model: 'current-model',
		})
	})

	it('restores resolved workflow behavior from durable task columns', () => {
		expect(
			importLauncherV3Draft({
				draftRow: {
					workflow_type: 'prd_tdd',
					worktree_timing: 'later',
					auto_advance_questions_to_research: false,
					auto_advance_research_to_design: false,
					auto_advance_plan_to_worktree: false,
					auto_advance_worktree_to_implementation: false,
					auto_advance_implementation_to_pr: false,
				},
			}),
		).toMatchObject({ workflowType: 'prd_tdd', worktreeTiming: 'later', autoAdvance: false })
	})

	it('restores presentation, graph reveal, toggle, and Phase 1 workspace choices from extras', () => {
		const restored = importLauncherV3Draft({
			draftRow: {
				workflow_type: 'outline_only',
				worktree_timing: 'now',
				auto_advance_questions_to_research: true,
			},
			localExtras: {
				workflowType: 'outline_only',
				autoAdvance: false,
				workflowPresentation: 'task-size',
				graphRevealed: true,
				workspaceSnapshotDirectory: '/repo',
				excludedRepositoryLocalPaths: ['packages/docs'],
				defaultLaunchRepositoryLocalPath: 'apps/riptide-ui',
			},
		})

		expect(restored).toMatchObject({
			workflowType: 'outline_only',
			autoAdvance: false,
			workflowPresentation: 'task-size',
			graphRevealed: true,
			worktreeTiming: 'now',
			workspaceSnapshotDirectory: '/repo',
			excludedRepositoryLocalPaths: ['packages/docs'],
			defaultLaunchRepositoryLocalPath: 'apps/riptide-ui',
		})
	})

	it('maps a legacy rpi row to the resolved V3 default instead of emitting rpi', () => {
		const restored = importLauncherV3Draft({ draftRow: { workflow_type: 'rpi' } })
		expect(restored.workflowType).toBe('outline_only')
	})

	it('rebuilds a ticket chip from durable row fields and lets extras win with the resolved ticket', () => {
		const durableOnly = importLauncherV3Draft({
			draftRow: {
				name: 'Linear draft',
				ticket_provider: 'linear',
				ticket_id: 'ENG-123',
				ticket_url: 'https://linear.app/acme/issue/ENG-123',
			},
		})
		expect(durableOnly.ticket).toEqual({
			provider: 'linear',
			ticketId: 'ENG-123',
			name: '',
			slug: '',
			url: 'https://linear.app/acme/issue/ENG-123',
			githubRepository: null,
		})

		const resolvedTicket = {
			provider: 'linear' as const,
			ticketId: 'ENG-123',
			name: '[ENG-123] Fix launch stalls',
			slug: 'eng-123-fix-launch-stalls',
			url: 'https://linear.app/acme/issue/ENG-123',
			githubRepository: null,
		}
		expect(
			importLauncherV3Draft({
				draftRow: { name: 'Linear draft', ticket_provider: 'linear', ticket_id: 'ENG-123' },
				localExtras: { ticket: resolvedTicket },
			}).ticket,
		).toEqual(resolvedTicket)
	})

	it('restores GitHub repository identity from durable row fields and skips incomplete tickets', () => {
		expect(
			importLauncherV3Draft({
				draftRow: {
					ticket_provider: 'github',
					ticket_id: '42',
					github_connection_id: '11111111-1111-4111-8111-111111111111',
					ticket_repository_id: '77',
					ticket_repository_full_name: 'acme/web',
				},
			}).ticket,
		).toMatchObject({
			provider: 'github',
			ticketId: '42',
			githubRepository: { connectionId: '11111111-1111-4111-8111-111111111111', fullName: 'acme/web' },
		})
		// A GitHub ticket without repository identity cannot render a working chip.
		expect(importLauncherV3Draft({ draftRow: { ticket_provider: 'github', ticket_id: '42' } }).ticket).toBeNull()
	})

	it('repairs corrupt fields without dropping valid neighbors', () => {
		expect(
			importLauncherV3Draft({
				draftRow: { name: 'Good title', slug: 42 },
				localExtras: { hostId: 'host-1', effort: 42, fastMode: true, deferredField: 'ignored' },
			}),
		).toMatchObject({ title: 'Good title', slug: '', hostId: 'host-1', effort: null, fastMode: true })
	})

	it('round-trips valid attachment metadata while dropping malformed and duplicate descriptors', () => {
		const attachment = {
			fileName: 'notes.txt',
			contentType: 'text/plain',
			fileSizeBytes: 5,
			contentHash: 'a'.repeat(64),
		}
		const values = importLauncherV3Draft({
			localExtras: {
				title: 'Keep this field',
				attachments: [
					attachment,
					{ ...attachment },
					{ ...attachment, fileName: '../unsafe.txt' },
					{ fileName: 'missing-metadata.txt' },
				],
			},
		})

		expect(values.title).toBe('Keep this field')
		expect(values.attachments).toEqual([attachment])

		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const localValues = toPersistedLauncherV3Draft(values).local
		expect(persistence.writeExtras('draft-attachments', localValues)).toBe(true)
		expect(persistence.readExtras('draft-attachments')?.attachments).toEqual([attachment])
		expect(persistence.writeRecovery(recoveryFromDraft('draft-attachments', localValues, 10))).toBe(true)
		expect(persistence.readRecovery()?.values.attachments).toEqual([attachment])
	})

	it.each([
		['bad JSON', 'bad'],
		['old version', JSON.stringify({ version: 0, values: persistedValues().local })],
		['future version', JSON.stringify({ version: 3, ...AUTH_SCOPE, values: persistedValues().local })],
		['bad values', JSON.stringify({ version: 1, values: { model: null } })],
	])('ignores %s extras', (_name, raw) => {
		const { storage } = memoryStorage({ [launcherV3DraftExtrasKey(AUTH_SCOPE, 'draft-1')]: raw })
		expect(createLauncherV3DraftPersistence(storage, AUTH_SCOPE).readExtras('draft-1')).toBeNull()
	})

	it('keeps extras isolated and coexisting across auth scopes', () => {
		const scopeB = { userId: 'user-2', organizationId: 'org-2' }
		const { storage, values } = memoryStorage()
		const persistenceA = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		expect(persistenceA.writeExtras('draft-1', persistedValues().local)).toBe(true)
		const keyA = launcherV3DraftExtrasKey(AUTH_SCOPE, 'draft-1')

		const persistenceB = createLauncherV3DraftPersistence(storage, scopeB)
		expect(persistenceB.readExtras('draft-1')).toBeNull()
		expect(
			persistenceB.writeExtras(
				'draft-1',
				toPersistedLauncherV3Draft(createLauncherV3DefaultValues({ title: 'Scope B' })).local,
			),
		).toBe(true)

		expect(values.has(keyA)).toBe(true)
		expect(persistenceA.readExtras('draft-1')).toMatchObject({ title: 'Draft title' })
		expect(persistenceB.readExtras('draft-1')).toMatchObject({ title: 'Scope B' })
	})

	it('sweeps only legacy unscoped launcher records at construction', () => {
		const oldKey = `${LEGACY_LAUNCHER_V3_DRAFT_EXTRAS_PREFIX}old-v1`
		const unstampedKey = `${LEGACY_LAUNCHER_V3_DRAFT_EXTRAS_PREFIX}unstamped`
		const foreignKey = launcherV3DraftExtrasKey({ userId: 'user-2', organizationId: 'org-1' }, 'foreign')
		const matchingKey = launcherV3DraftExtrasKey(AUTH_SCOPE, 'matching')
		const unrelatedKey = 'unrelated:key'
		const { storage, values } = memoryStorage({
			[LEGACY_LAUNCHER_V3_ACTIVE_RECOVERY_KEY]: JSON.stringify({ version: 1 }),
			[oldKey]: JSON.stringify({ version: 1, values: persistedValues().local }),
			[unstampedKey]: JSON.stringify({ version: 2, values: persistedValues().local }),
			[foreignKey]: JSON.stringify({
				version: 2,
				userId: 'user-2',
				organizationId: 'org-1',
				values: persistedValues().local,
			}),
			[matchingKey]: JSON.stringify({ version: 2, ...AUTH_SCOPE, values: persistedValues().local }),
			[unrelatedKey]: 'keep me',
		})

		createLauncherV3DraftPersistence(storage, AUTH_SCOPE)

		expect([...values.keys()]).toEqual([foreignKey, matchingKey, unrelatedKey])
	})
})

describe('Launcher V3 active recovery', () => {
	it('round-trips the one active versioned recovery record', () => {
		const { storage, values } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const recovery = recoveryFromDraft('draft-1', persistedValues().local, 123)
		persistence.writeRecovery(recovery)

		expect(values.size).toBe(1)
		expect(values.has(launcherV3ActiveRecoveryKey(AUTH_SCOPE))).toBe(true)
		expect(persistence.readRecovery()).toEqual({ ...recovery, ...AUTH_SCOPE })
	})

	it('round-trips workflow presentation and graph state in active recovery', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const values = createLauncherV3DefaultValues({
			workflowType: 'prd_tdd',
			autoAdvance: false,
			workflowPresentation: 'task-size',
			graphRevealed: true,
			workspaceSnapshotDirectory: '/repo',
			excludedRepositoryLocalPaths: ['docs'],
			defaultLaunchRepositoryLocalPath: '.',
		})
		const recovery = recoveryFromDraft('draft-guided', toPersistedLauncherV3Draft(values).local, 123)

		persistence.writeRecovery(recovery)

		expect(persistence.readRecovery()?.values).toMatchObject({
			workflowType: 'prd_tdd',
			autoAdvance: false,
			workflowPresentation: 'task-size',
			graphRevealed: true,
			workspaceSnapshotDirectory: '/repo',
			excludedRepositoryLocalPaths: ['docs'],
			defaultLaunchRepositoryLocalPath: '.',
		})
	})

	it('only clears recovery when the draft id matches', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		persistence.writeRecovery(recoveryFromDraft('draft-1', persistedValues().local))
		persistence.removeRecovery('draft-2')
		expect(persistence.readRecovery()?.draftId).toBe('draft-1')
		persistence.removeRecovery('draft-1')
		expect(persistence.readRecovery()).toBeNull()
	})

	it('treats corrupt or unavailable storage as empty and best effort', () => {
		const persistence = createLauncherV3DraftPersistence(
			{
				get length() {
					throw new Error('blocked')
				},
				key: () => {
					throw new Error('blocked')
				},
				getItem: () => {
					throw new Error('blocked')
				},
				setItem: () => {
					throw new Error('full')
				},
				removeItem: () => {
					throw new Error('blocked')
				},
			},
			AUTH_SCOPE,
		)
		expect(persistence.readExtras('draft-1')).toBeNull()
		expect(persistence.readRecovery()).toBeNull()
		expect(persistence.writeExtras('draft-1', persistedValues().local)).toBe(false)
		expect(persistence.writeRecovery(recoveryFromDraft('draft-1', persistedValues().local))).toBe(false)
		expect(() => persistence.removeRecovery('draft-1')).not.toThrow()
	})

	it('keeps active recovery isolated and coexisting across auth scopes', () => {
		const scopeB = { userId: 'user-1', organizationId: 'org-2' }
		const { storage, values } = memoryStorage()
		const persistenceA = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const persistenceB = createLauncherV3DraftPersistence(storage, scopeB)
		const recoveryA = recoveryFromDraft('draft-a', persistedValues().local, 1)
		const recoveryB = recoveryFromDraft(
			'draft-b',
			toPersistedLauncherV3Draft(createLauncherV3DefaultValues({ title: 'Scope B' })).local,
			2,
		)

		expect(persistenceA.writeRecovery(recoveryA)).toBe(true)
		expect(persistenceB.writeRecovery(recoveryB)).toBe(true)
		expect(persistenceA.readRecovery()).toMatchObject({ draftId: 'draft-a' })
		expect(persistenceB.readRecovery()).toMatchObject({ draftId: 'draft-b' })
		expect(values.has(launcherV3ActiveRecoveryKey(AUTH_SCOPE))).toBe(true)
		expect(values.has(launcherV3ActiveRecoveryKey(scopeB))).toBe(true)
	})
})

describe('Launcher V3 draft lifecycle', () => {
	it('generates launch IDs once, preserves them through retries, and clears them only after commit', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const ids = ['draft-1', 'session-1', 'event-1']
		const lifecycle = createLauncherV3DraftLifecycle({
			persistence,
			createId: () => ids.shift() ?? 'unexpected-id',
		})

		const identity = lifecycle.ensureLaunchIdentity()
		expect(lifecycle.ensureLaunchIdentity()).toEqual(identity)
		expect(identity).toEqual({
			draftId: 'draft-1',
			firstSessionId: 'session-1',
			firstEventId: 'event-1',
			state: 'editing',
		})
		lifecycle.markLaunching()
		expect(persistence.readLaunchIdentity('draft-1')).toEqual({ ...identity, state: 'launching' })
		lifecycle.markIdle()
		expect(persistence.readLaunchIdentity('draft-1')).toEqual(identity)
		lifecycle.markCommitted('draft-1')
		expect(persistence.readLaunchIdentity('draft-1')).toBeNull()
	})

	it('keeps one identity and synchronously consumes matching local records', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const local = persistedValues().local
		persistence.writeExtras('draft-1', local)
		persistence.writeRecovery(recoveryFromDraft('draft-1', local))
		const lifecycle = createLauncherV3DraftLifecycle({
			persistence,
			createId: () => 'draft-1',
		})

		expect(lifecycle.ensureId()).toBe('draft-1')
		expect(lifecycle.ensureId()).toBe('draft-1')
		expect(lifecycle.state()).toBe('idle')
		lifecycle.markLaunching()
		expect(lifecycle.state()).toBe('launching')
		lifecycle.markIdle()
		expect(lifecycle.state()).toBe('idle')
		lifecycle.markCommitted('draft-1')

		expect(lifecycle.state()).toBe('committed')
		expect(lifecycle.isCommitted()).toBe(true)
		expect(persistence.readExtras('draft-1')).toBeNull()
		expect(persistence.readRecovery()).toBeNull()
	})

	it('does not clear another recovery record or reactivate a consumed lifecycle', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		persistence.writeRecovery(recoveryFromDraft('another-draft', persistedValues().local))
		const lifecycle = createLauncherV3DraftLifecycle({ initialId: 'draft-1', persistence })

		lifecycle.markCommitted('draft-1')
		lifecycle.setActive('stale-tab-id')

		expect(lifecycle.activeId()).toBe('draft-1')
		expect(lifecycle.isCommitted()).toBe(true)
		expect(persistence.readRecovery()?.draftId).toBe('another-draft')
	})

	it('reports both identities when re-keying and cannot leave committed state', () => {
		const { storage } = memoryStorage()
		const lifecycle = createLauncherV3DraftLifecycle({
			initialId: 'displaced-id',
			persistence: createLauncherV3DraftPersistence(storage, AUTH_SCOPE),
			createId: () => 'replacement-id',
		})

		expect(lifecycle.reassignId()).toEqual({
			result: 'reassigned',
			displacedId: 'displaced-id',
			replacementId: 'replacement-id',
		})
		expect(lifecycle.takeDisplacedIds('replacement-id')).toEqual(['displaced-id'])
		lifecycle.markCommitted('replacement-id')
		lifecycle.markIdle()
		lifecycle.markLaunching()

		expect(lifecycle.state()).toBe('committed')
		expect(lifecycle.reassignId()).toEqual({
			result: 'reassigned',
			displacedId: 'replacement-id',
			replacementId: 'replacement-id',
		})
	})

	it('commit clears every pending displaced identity and the committed replacement', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const local = persistedValues().local
		persistence.writeRecovery(recoveryFromDraft('draft-a', local))
		persistence.writeExtras('draft-a', local)
		persistence.writeExtras('draft-b', local)
		const lifecycle = createLauncherV3DraftLifecycle({
			initialId: 'draft-a',
			persistence,
			createId: () => 'draft-b',
		})

		const reassignment = lifecycle.reassignId()
		expect(reassignment.result).toBe('reassigned')
		if (reassignment.result !== 'reassigned') throw new Error('Expected reassignment')
		expect(reassignment.replacementId).toBe('draft-b')
		lifecycle.markCommitted('draft-b')

		expect(persistence.readRecovery()).toBeNull()
		expect(persistence.readExtras('draft-a')).toBeNull()
		expect(persistence.readExtras('draft-b')).toBeNull()
	})

	it('detached lifecycle commits only in memory and leaves persisted records untouched', () => {
		const { storage } = memoryStorage()
		const persistence = createLauncherV3DraftPersistence(storage, AUTH_SCOPE)
		const local = persistedValues().local
		persistence.writeRecovery(recoveryFromDraft('draft-a', local))
		persistence.writeExtras('draft-a', local)
		const lifecycle = createLauncherV3DraftLifecycle({ initialId: 'draft-a', persistence })

		lifecycle.disableCommitCleanup()
		lifecycle.markCommitted('draft-a')

		expect(lifecycle.state()).toBe('committed')
		expect(persistence.readRecovery()).toMatchObject({ draftId: 'draft-a' })
		expect(persistence.readExtras('draft-a')).toEqual(local)
	})

	it('rejects identity reassignment after a presign request binds uploads to the active id', () => {
		const { storage } = memoryStorage()
		const lifecycle = createLauncherV3DraftLifecycle({
			initialId: 'attachment-task-id',
			persistence: createLauncherV3DraftPersistence(storage, AUTH_SCOPE),
			createId: () => 'must-not-be-used',
		})

		expect(lifecycle.hasUploadBoundIdentity()).toBe(false)
		expect(lifecycle.bindUploadsToActiveId()).toBe('attachment-task-id')
		expect(lifecycle.hasUploadBoundIdentity()).toBe(true)
		expect(lifecycle.reassignId()).toEqual({
			result: 'upload-bound-conflict',
			activeId: 'attachment-task-id',
		})
		expect(lifecycle.activeId()).toBe('attachment-task-id')
	})
})
