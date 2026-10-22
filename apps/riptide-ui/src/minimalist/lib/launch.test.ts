import { ORPCError } from '@orpc/client'
import { describe, expect, it, vi } from 'vitest'

import { DESCRIBE_PR_NEXT_STEP_PROMPT } from '@/lib/auto-advance'
import {
	defaultTarget,
	draftTitle,
	launchError,
	launchHost,
	slugify,
	startTask,
	workingCopy,
} from '@/minimalist/lib/launch'
import type { ComposerSettings } from '@/minimalist/lib/models'
import type { Ticket } from '@/minimalist/lib/tickets'
import type { RiptideApiClient } from '@/orpc/client'

describe('draftTitle', () => {
	it('takes the first line without a slash command', () => {
		expect(draftTitle('  /research_codebase how auth works\nmore detail')).toBe('how auth works')
		expect(draftTitle('')).toBe('Untitled task')
		expect(draftTitle('x'.repeat(80))).toHaveLength(64)
	})
})

describe('defaultTarget', () => {
	const project = { id: 'p2', name: 'Other' }

	it("goes where you last worked: the latest task's project", () => {
		const latest = { task: { project_id: 'p1' }, projectName: 'App' }
		expect(defaultTarget({ latest, directory: '/r', project })).toEqual({
			kind: 'project',
			projectId: 'p1',
			name: 'App',
		})
	})

	it('falls back to a recent directory, then any project', () => {
		const latest = { task: { project_id: null }, projectName: 'r' }
		expect(defaultTarget({ latest, directory: '/r', project })).toEqual({ kind: 'directory', path: '/r' })
		expect(defaultTarget({ latest: undefined, directory: undefined, project })).toEqual({
			kind: 'project',
			projectId: 'p2',
			name: 'Other',
		})
		expect(defaultTarget({ latest: undefined, directory: undefined, project: undefined })).toBeNull()
	})
})

describe('launchHost', () => {
	const hosts = [
		{ host: { host_id: 'mac' }, online: false },
		{ host: { host_id: 'box' }, online: true },
		{ host: { host_id: 'vm' }, online: true },
	]

	it('starts a new task on the picked host, or any online one', () => {
		expect(launchHost(hosts, { picked: 'vm', task: null })?.host.host_id).toBe('vm')
		expect(launchHost(hosts, { picked: null, task: null })?.host.host_id).toBe('box')
	})

	it('keeps a directory task on its host, even offline, and moves a project task off an offline one', () => {
		expect(launchHost(hosts, { picked: 'vm', task: { hostId: 'mac', movable: false } })?.host.host_id).toBe('mac')
		expect(launchHost(hosts, { picked: null, task: { hostId: 'mac', movable: true } })?.host.host_id).toBe('box')
		expect(launchHost(hosts, { picked: null, task: { hostId: 'vm', movable: true } })?.host.host_id).toBe('vm')
	})
})

describe('workingCopy', () => {
	const base = { inTask: false, project: true, clonesFirst: false, hostName: 'box', movedFrom: null }

	it('names a worktree, a first clone, or the directory itself for a new task', () => {
		expect(workingCopy(base)).toMatchObject({ label: 'New worktree', branch: true })
		expect(workingCopy({ ...base, clonesFirst: true })?.title).toBe(
			'box clones the repository the first time, then makes a branch named after the task',
		)
		expect(workingCopy({ ...base, project: false })).toMatchObject({ label: 'In this directory', branch: false })
		expect(
			workingCopy({ ...base, project: false, directoryWorktrees: { repositories: 1, configured: false } }),
		).toMatchObject({ label: 'New worktree', branch: true })
		expect(
			workingCopy({ ...base, project: false, directoryWorktrees: { repositories: 3, configured: true } }),
		).toMatchObject({ label: '3 new worktrees', branch: true })
	})

	it('says nothing for a session in a task unless it moved hosts', () => {
		expect(workingCopy({ ...base, inTask: true })).toBeNull()
		expect(workingCopy({ ...base, inTask: true, movedFrom: 'mac' })?.title).toContain('stay on mac')
	})
})

describe('launchError', () => {
	const kept = 'Your prompt is still in the composer.'

	it("gives the server's reason for a name already in use", () => {
		const error = new ORPCError('TASK_SLUG_CONFLICT', {
			defined: true,
			status: 409,
			data: { slug: 'fix-auth', message: 'The name "fix-auth" is taken.' },
		})
		expect(launchError(error)).toBe(`Could not start the task. The name "fix-auth" is taken. ${kept}`)
	})

	it('says what to do about billing and access', () => {
		expect(launchError(new ORPCError('BILLING_REQUIRED', { status: 402 }))).toContain('Settings → Billing')
		expect(launchError(new ORPCError('FORBIDDEN', { status: 403 }))).toContain("can't start tasks here")
	})

	it('keeps to the plain message otherwise', () => {
		expect(launchError(new Error('boom'))).toBe(`Could not start the task. ${kept}`)
	})
})

describe('slugify', () => {
	it('keeps letters and digits and adds the suffix', () => {
		expect(slugify('Fix the login bug!', '1a2b')).toBe('fix-the-login-bug-1a2b')
		expect(slugify('***', '1a2b')).toBe('task-1a2b')
	})
})

describe('startTask', () => {
	const ids = { taskId: 'task-0001', sessionId: 'session-1', eventId: 'event-1' }
	const settings: ComposerSettings = {
		agent: 'claude',
		model: 'opus',
		effort: 'high',
		fastMode: false,
		permissionsMode: 'auto',
	}
	const repository = {
		remoteUrl: 'git@github.com:acme/app.git',
		repositoryIdentity: 'github.com/acme/app',
		defaultBranch: 'main',
		default: true,
		autoPushBranch: true,
		copyGlobs: [],
	}
	const ticket: Ticket = {
		provider: 'linear',
		ticketId: 'ENG-9',
		name: '[ENG-9] Fix login',
		slug: 'eng-9-fix-login',
		url: null,
		githubRepository: null,
	}

	function fakeApi() {
		const api = {
			projects: { v2: { repositorySources: { get: vi.fn(async () => ({ sources: [] })), upsert: vi.fn() } } },
			tasks: { v2: { create: vi.fn(async () => ({})) }, launchDraft: vi.fn(async () => ({})), update: vi.fn() },
			ai: { generateTitle: vi.fn(async () => ({ title: 'Agent title' })) },
		}
		return { api, client: api as unknown as RiptideApiClient }
	}

	it('creates a project task on a branch named after it, then asks for a title', async () => {
		const { api, client } = fakeApi()
		await startTask(client, {
			ids,
			target: { kind: 'project', project: { id: 'p1', repositories: [repository] } },
			hostId: 'h1',
			draft: 'Fix the login bug',
			ticket: null,
			attachments: [],
			settings,
			workflow: { workflowType: 'freeform', autoAdvance: false },
		})
		expect(api.projects.v2.repositorySources.get).toHaveBeenCalled()
		const [created] = api.tasks.v2.create.mock.calls[0] as unknown as [Record<string, unknown>]
		expect(created).toMatchObject({
			name: 'Fix the login bug',
			slug: 'fix-the-login-bug-0001',
			projectId: 'p1',
			defaultRepositoryIdentity: 'github.com/acme/app',
			repositories: [{ repositoryIdentity: 'github.com/acme/app', branch: 'fix-the-login-bug-0001' }],
			firstSession: { hostId: 'h1', model: 'opus', permissionsMode: 'auto' },
		})
		expect(api.ai.generateTitle).toHaveBeenCalledWith({ text: 'Fix the login bug' })
	})

	it('runs a directory task in place, named after its issue', async () => {
		const { api, client } = fakeApi()
		await startTask(client, {
			ids,
			target: { kind: 'directory', path: '/code/app' },
			hostId: 'h1',
			draft: '',
			ticket,
			attachments: [],
			settings,
			workflow: { workflowType: 'freeform', autoAdvance: false },
		})
		expect(api.tasks.v2.create).not.toHaveBeenCalled()
		const [launched] = api.tasks.launchDraft.mock.calls[0] as unknown as [Record<string, unknown>]
		expect(launched).toMatchObject({
			name: '[ENG-9] Fix login',
			slug: 'eng-9-fix-login',
			defaultWorkingDirectory: '/code/app',
			worktreeTiming: 'never',
			ticketProvider: 'linear',
			ticketId: 'ENG-9',
			firstSession: { workingDirectory: '/code/app' },
		})
		expect(api.ai.generateTitle).not.toHaveBeenCalled()
	})

	it("starts a directory task in the worktrees its plan sets up, from the task's slug", async () => {
		const { api, client } = fakeApi()
		const workspaceSpec = { specVersion: 1, directory: '/code/app', repos: [] }
		const worktree = vi.fn((slug: string) => ({
			workspaceSpec: workspaceSpec as never,
			defaultWorkingDirectory: `/wt/${slug}/app`,
		}))
		await startTask(client, {
			ids,
			target: { kind: 'directory', path: '/code/app', worktree },
			hostId: 'h1',
			draft: '',
			ticket,
			attachments: [],
			settings,
			workflow: { workflowType: 'freeform', autoAdvance: false },
		})
		expect(worktree).toHaveBeenCalledWith('eng-9-fix-login')
		const [launched] = api.tasks.launchDraft.mock.calls[0] as unknown as [Record<string, unknown>]
		expect(launched).toMatchObject({
			defaultWorkingDirectory: '/wt/eng-9-fix-login/app',
			worktreeTiming: 'now',
			workspaceSpec,
			firstSession: { workingDirectory: '/wt/eng-9-fix-login/app' },
		})
	})
	it('starts a medium task on its research questions, with the prompt as the task content', async () => {
		const { api, client } = fakeApi()
		await startTask(client, {
			ids,
			target: { kind: 'project', project: { id: 'p1', repositories: [repository] } },
			hostId: 'h1',
			draft: 'Fix the login bug',
			ticket: null,
			attachments: [],
			settings,
			workflow: { workflowType: 'outline_only', autoAdvance: true },
		})
		const [created] = api.tasks.v2.create.mock.calls[0] as unknown as [Record<string, unknown>]
		expect(created).toMatchObject({
			workflowType: 'outline_only',
			taskContent: 'Fix the login bug',
			autoAdvanceQuestionsToResearch: true,
			autoAdvanceResearchToDesign: true,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: false,
			firstSession: {
				text: 'use the rpi:create-research-questions skill for .humanlayer/tasks/fix-the-login-bug-0001',
				permissionsMode: 'bypass',
			},
		})
	})
	it.each([true, false])(
		'starts a small task on implementation and asks it to offer describe-pr (auto-advance %s)',
		async (autoAdvance) => {
			const { api, client } = fakeApi()
			await startTask(client, {
				ids,
				target: { kind: 'project', project: { id: 'p1', repositories: [repository] } },
				hostId: 'h1',
				draft: 'Fix the login bug',
				ticket: null,
				attachments: [],
				settings,
				workflow: { workflowType: 'freeform', autoAdvance },
				directImplementation: true,
			})
			const [created] = api.tasks.v2.create.mock.calls[0] as unknown as [Record<string, unknown>]
			const prompt = 'Fix the login bug\n\n' + DESCRIBE_PR_NEXT_STEP_PROMPT
			expect(created).toMatchObject({
				workflowType: 'freeform',
				taskContent: prompt,
				autoAdvanceQuestionsToResearch: false,
				autoAdvanceImplementationToPr: autoAdvance,
				firstSession: { text: prompt, intent: 'implementation', permissionsMode: settings.permissionsMode },
			})
		},
	)
})
