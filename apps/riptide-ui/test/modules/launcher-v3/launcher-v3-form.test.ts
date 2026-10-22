import { describe, expect, it } from 'vitest'

import { TASK_SLUG_MAX_LENGTH } from '@/lib/task-slug'
import {
	createLauncherV3DefaultValues,
	getLaunchReadiness,
	isLauncherV3Touched,
	launcherV3DraftIsMeaningful,
	launcherV3FormSchema,
	toLaunchCommand,
	toPersistedLauncherV3Draft,
	type LauncherV3FormValues,
} from '@/modules/launcher-v3/launcher-v3-form'

function launchable(overrides: Partial<LauncherV3FormValues> = {}): LauncherV3FormValues {
	return createLauncherV3DefaultValues({
		prompt: '  Build the launcher  ',
		title: '  Launcher V3  ',
		slug: '  launcher-v3  ',
		hostId: 'host-1',
		directory: '  /repo  ',
		...overrides,
	})
}

describe('launcherV3FormSchema', () => {
	it('owns the reduced inline composer defaults', () => {
		expect(launcherV3FormSchema.parse({})).toEqual({
			prompt: null,
			ticket: null,
			title: '',
			slug: '',
			hostId: null,
			directory: '',
			projectId: null,
			projectDefaultRepositoryIdentity: null,
			permissionsMode: 'auto',
			agent: 'claude',
			provider: 'anthropic',
			model: 'opus',
			effort: null,
			fastMode: false,
			workflowType: 'outline_only',
			autoAdvance: true,
			workflowPresentation: 'named',
			graphRevealed: false,
			worktreeTiming: 'later',
			workspaceSnapshotDirectory: null,
			excludedRepositoryLocalPaths: [],
			defaultLaunchRepositoryLocalPath: null,
			attachments: [],
			createdWithExperimentFlags: null,
		})
	})

	it('drops fields from deferred composer flows', () => {
		expect(launcherV3FormSchema.parse({ workflow: 'prd_tdd' })).not.toHaveProperty('workflow')
		expect(launcherV3FormSchema.parse({ issueSource: 'linear' })).not.toHaveProperty('issueSource')
	})

	it('requires repository identity for GitHub tickets only', () => {
		expect(
			launcherV3FormSchema.safeParse({
				ticket: { provider: 'github', ticketId: '12', githubRepository: null },
			}).success,
		).toBe(false)
		expect(launcherV3FormSchema.safeParse({ ticket: { provider: 'linear', ticketId: 'ENG-123' } }).success).toBe(
			true,
		)
	})
})

function linearTicket() {
	return {
		provider: 'linear' as const,
		ticketId: 'ENG-123',
		name: '[ENG-123] Fix launch stalls',
		slug: 'eng-123-fix-launch-stalls',
		url: 'https://linear.app/acme/issue/ENG-123',
		githubRepository: null,
	}
}

function githubTicket() {
	return {
		provider: 'github' as const,
		ticketId: '42',
		name: '[acme/web#42] Fix launch stalls',
		slug: 'acme-web-42-fix-launch-stalls',
		url: 'https://github.com/acme/web/issues/42',
		githubRepository: {
			connectionId: '11111111-1111-4111-8111-111111111111',
			repositoryId: '77',
			fullName: 'acme/web',
			accountLogin: 'acme',
			private: false,
			archived: false,
		},
	}
}

describe('getLaunchReadiness', () => {
	it.each([
		['host', {}, 'no-host'],
		['directory', { hostId: 'host-1' }, 'no-directory'],
		['prompt', { hostId: 'host-1', directory: '/repo' }, 'no-prompt'],
		['title', { hostId: 'host-1', directory: '/repo', prompt: 'work' }, 'no-title'],
		['slug', { hostId: 'host-1', directory: '/repo', prompt: 'work', title: 'Work' }, 'no-slug'],
	] as const)('blocks on %s', (_name, overrides, code) => {
		const readiness = getLaunchReadiness(createLauncherV3DefaultValues(overrides))
		expect(readiness.canLaunch).toBe(false)
		expect(readiness.blockedReason?.code).toBe(code)
	})

	it('allows a complete inline launch', () => {
		expect(getLaunchReadiness(launchable())).toEqual({ canLaunch: true, blockedReason: null })
	})

	it('accepts a selected project in place of a working directory', () => {
		const values = launchable({ directory: '', projectId: 'project-1' })
		expect(getLaunchReadiness(values)).toEqual({ canLaunch: true, blockedReason: null })
	})

	it('accepts a ticket attachment in place of a prompt', () => {
		const values = launchable({ prompt: null, ticket: linearTicket() })
		expect(getLaunchReadiness(values)).toEqual({ canLaunch: true, blockedReason: null })
	})

	it('still requires either a prompt or a ticket', () => {
		const readiness = getLaunchReadiness(launchable({ prompt: null }))
		expect(readiness.blockedReason?.code).toBe('no-prompt')
		expect(readiness.blockedReason?.label).toBe('Describe the task or attach a ticket')
	})
})

describe('draft projection', () => {
	it('serializes enabled Freeform auto-advance as PR-only with the toggle in extras', () => {
		const persisted = toPersistedLauncherV3Draft(launchable({ workflowType: 'freeform', autoAdvance: true }))

		expect(persisted.durable).toMatchObject({
			workflowType: 'freeform',
			autoAdvanceQuestionsToResearch: false,
			autoAdvanceResearchToDesign: false,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: true,
		})
		expect(persisted.local).toMatchObject({ workflowType: 'freeform', autoAdvance: true })
	})

	it('splits task row fields from the reduced V3 form extras', () => {
		const values = launchable({
			prompt: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build it' }] }] },
			effort: 'high',
			fastMode: true,
			createdWithExperimentFlags: {
				task_composer: { assigned_group: 'v3_composer', actual_form: 'v3_composer' },
			},
		})

		expect(toPersistedLauncherV3Draft(values)).toEqual({
			version: 1,
			durable: {
				name: 'Launcher V3',
				slug: 'launcher-v3',
				defaultWorkingDirectory: '/repo',
				ticketDescription: 'Build it',
				workflowType: 'outline_only',
				worktreeTiming: 'later',
				autoAdvanceQuestionsToResearch: true,
				autoAdvanceResearchToDesign: true,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: true,
				autoAdvanceImplementationToPr: false,
			},
			local: {
				prompt: values.prompt,
				ticket: null,
				title: '  Launcher V3  ',
				slug: '  launcher-v3  ',
				hostId: 'host-1',
				directory: '  /repo  ',
				projectId: null,
				projectDefaultRepositoryIdentity: null,
				permissionsMode: 'auto',
				agent: 'claude',
				provider: 'anthropic',
				model: 'opus',
				effort: 'high',
				fastMode: true,
				workflowType: 'outline_only',
				autoAdvance: true,
				workflowPresentation: 'named',
				graphRevealed: false,
				worktreeTiming: 'later',
				workspaceSnapshotDirectory: null,
				excludedRepositoryLocalPaths: [],
				defaultLaunchRepositoryLocalPath: null,
				attachments: [],
			},
		})
	})

	it('persists ticket identity on the durable row and the full ticket locally', () => {
		const persisted = toPersistedLauncherV3Draft(launchable({ ticket: githubTicket() }))
		expect(persisted.durable).toMatchObject({
			ticketProvider: 'github',
			ticketId: '42',
			githubConnectionId: '11111111-1111-4111-8111-111111111111',
			ticketRepositoryId: '77',
			ticketRepositoryFullName: 'acme/web',
		})
		expect(persisted.local.ticket).toEqual(githubTicket())
	})

	it('treats a ticket attachment as meaningful draft content', () => {
		expect(launcherV3DraftIsMeaningful(createLauncherV3DefaultValues({ ticket: linearTicket() }))).toBe(true)
	})

	it('distinguishes meaningful work from changed settings', () => {
		const baseline = createLauncherV3DefaultValues()
		const settingsOnly = createLauncherV3DefaultValues({ directory: '/repo', fastMode: true })
		expect(launcherV3DraftIsMeaningful(settingsOnly)).toBe(false)
		expect(isLauncherV3Touched(settingsOnly, baseline)).toBe(true)
		expect(launcherV3DraftIsMeaningful(createLauncherV3DefaultValues({ prompt: 'work' }))).toBe(true)
		expect(launcherV3DraftIsMeaningful(createLauncherV3DefaultValues({ title: 'Work' }))).toBe(true)
	})

	it('returns to untouched and ignores attribution', () => {
		const baseline = createLauncherV3DefaultValues()
		expect(isLauncherV3Touched(createLauncherV3DefaultValues({ prompt: '  ' }), baseline)).toBe(false)
		expect(
			isLauncherV3Touched(
				createLauncherV3DefaultValues({
					createdWithExperimentFlags: {
						task_composer: { assigned_group: 'v2_form', actual_form: 'v3_composer' },
					},
				}),
				baseline,
			),
		).toBe(false)
	})
})

describe('toLaunchCommand', () => {
	it('materializes project workspaces immediately without changing directory-backed browser timing', () => {
		const values = launchable({ projectId: 'project-1', directory: '', worktreeTiming: 'later' })
		const project = { projectId: 'project-1', defaultRepositoryIdentity: 'github.com/acme/repo', repositories: [] }
		const command = toLaunchCommand(values, { kind: 'project', project })
		expect(command.worktreeTiming).toBe('now')
		expect(command.autoAdvanceFlags).toEqual(
			toLaunchCommand(launchable({ worktreeTiming: 'now' })).autoAdvanceFlags,
		)
		expect(command.project).toEqual(project)
		expect(command.workspaceSpec).toBeUndefined()
		expect(toLaunchCommand(launchable({ worktreeTiming: 'later' })).worktreeTiming).toBe('later')
	})

	it('projects enabled Freeform auto-advance without changing prompt or permissions', () => {
		const command = toLaunchCommand(
			launchable({ workflowType: 'freeform', autoAdvance: true, permissionsMode: 'accept_edits' }),
		)

		expect(command).toMatchObject({
			workflowType: 'freeform',
			autoAdvance: true,
			promptText: 'Build the launcher',
			permissionsMode: 'accept_edits',
			autoAdvanceFlags: {
				autoAdvanceQuestionsToResearch: false,
				autoAdvanceResearchToDesign: false,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: false,
				autoAdvanceImplementationToPr: true,
			},
		})
	})

	it('normalizes input and projects workflow and worktree behavior', () => {
		const flags = {
			task_composer: { assigned_group: 'v3_composer' as const, actual_form: 'v3_composer' as const },
		}
		expect(toLaunchCommand(launchable({ effort: 'high', createdWithExperimentFlags: flags }))).toEqual({
			promptText: 'Build the launcher',
			ticket: null,
			title: 'Launcher V3',
			slug: 'launcher-v3',
			hostId: 'host-1',
			directory: '/repo',
			workflowType: 'outline_only',
			autoAdvance: true,
			worktreeTiming: 'later',
			autoAdvanceFlags: {
				autoAdvanceQuestionsToResearch: true,
				autoAdvanceResearchToDesign: true,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: true,
				autoAdvanceImplementationToPr: false,
			},
			directImplementation: false,
			permissionsMode: 'auto',
			agent: 'claude',
			provider: 'anthropic',
			model: 'opus',
			effort: 'high',
			fastMode: false,
			attachments: [],
			createdWithExperimentFlags: flags,
		})
	})

	it('marks Small as direct implementation only in the task-size presentation', () => {
		const freeform = { workflowType: 'freeform' as const, autoAdvance: true }
		expect(
			toLaunchCommand(launchable({ ...freeform, workflowPresentation: 'task-size' })).directImplementation,
		).toBe(true)
		expect(toLaunchCommand(launchable({ ...freeform, workflowPresentation: 'named' })).directImplementation).toBe(
			false,
		)
	})

	it('never emits the legacy rpi workflow value', () => {
		const command = toLaunchCommand(launchable({ workflowType: 'outline_only' }))
		expect(command.workflowType).toBe('outline_only')
		expect(command.workflowType).not.toBe('rpi')
	})

	it('uses the selected directory without workspace setup when Git is unavailable', () => {
		const command = toLaunchCommand(launchable({ worktreeTiming: 'now' }), {
			kind: 'in-place',
			defaultWorkingDirectory: '/plain-directory',
		})

		expect(command).toMatchObject({
			worktreeTiming: 'never',
			defaultWorkingDirectory: '/plain-directory',
		})
		expect(command.workspaceSpec).toBeUndefined()
	})

	it('normalizes the attached ticket', () => {
		const command = toLaunchCommand(
			launchable({ ticket: { ...linearTicket(), ticketId: ' ENG-123 ', name: ' [ENG-123] Fix ' } }),
		)
		expect(command.ticket).toEqual({ ...linearTicket(), name: '[ENG-123] Fix' })
	})

	it('dedupes finalized attachments in selection order', () => {
		const attachment = {
			fileName: 'notes.txt',
			contentType: 'text/plain',
			fileSizeBytes: 5,
			contentHash: 'a'.repeat(64),
		}
		const other = {
			fileName: 'diagram.png',
			contentType: 'image/png',
			fileSizeBytes: 10,
			contentHash: 'b'.repeat(64),
		}
		const command = toLaunchCommand(launchable({ attachments: [attachment, attachment, other] }))
		expect(command.attachments).toEqual([attachment, other])
	})

	it('treats a finalized attachment as meaningful draft content', () => {
		const attachment = {
			fileName: 'notes.txt',
			contentType: 'text/plain',
			fileSizeBytes: 5,
			contentHash: 'a'.repeat(64),
		}
		expect(launcherV3DraftIsMeaningful(createLauncherV3DefaultValues({ attachments: [attachment] }))).toBe(true)
	})

	it('truncates a long slug before launch', () => {
		const command = toLaunchCommand(launchable({ slug: 'a'.repeat(TASK_SLUG_MAX_LENGTH + 1) }))

		expect(command.slug).toBe('a'.repeat(TASK_SLUG_MAX_LENGTH))
	})
})
