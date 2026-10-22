import { Exit } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import {
	hasRepositoryUrlCredentials,
	normalizeRepositoryIdentity,
	ProjectRepositories,
	repositoryNameFromIdentity,
} from '../src/effect/project-workspace/project-recipe'
import { WorkspaceRepositories } from '../src/effect/project-workspace/workspace-recipe'
import {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupResult,
} from '../src/effect/project-workspace/workspace-repository-status'
import { ProjectRepositoriesSchema } from '../src/zod/project-workspace/project-recipe'
import { WorkspaceRepositoriesSchema } from '../src/zod/project-workspace/workspace-recipe'
import {
	WorkspaceRepositoryActorSnapshotSchema,
	WorkspaceRepositorySetupResultSchema,
} from '../src/zod/project-workspace/workspace-repository-status'

const repository = {
	remoteUrl: 'git@github.com:humanlayer/syncopate.git',
	repositoryIdentity: 'github.com/humanlayer/syncopate',
	defaultBranch: 'main',
	default: true,
	autoPushBranch: false,
	copyGlobs: [],
}

function effectAccepts(value: unknown): boolean {
	return Exit.isSuccess(Schema.decodeUnknownExit(ProjectRepositories)(value))
}

const workspaceRepository = {
	...repository,
	branch: 'workspace/phase-3',
	baseCommit: '0123456789abcdef0123456789abcdef01234567',
}

describe('project workspace schema parity', () => {
	test.each([
		['https://secret-token@github.com/humanlayer/syncopate.git', false],
		['https://user:secret-token@github.com/humanlayer/syncopate.git', false],
		['HTTPS://user:secret-token@github.com/humanlayer/syncopate.git', false],
		['http://user:secret-token@github.com/humanlayer/syncopate.git', false],
		['https://user%40name:secret-token@github.com/humanlayer/syncopate.git', false],
		['ssh://git:secret-token@github.com/humanlayer/syncopate.git', false],
		['https://github.com/humanlayer/syncopate.git', true],
		['git@github.com:humanlayer/syncopate.git', true],
		['ssh://git@github.com/humanlayer/syncopate.git', true],
	])('keeps credential policy in parity for %s', (remoteUrl, accepted) => {
		expect(hasRepositoryUrlCredentials(remoteUrl)).toBe(!accepted)
		const effectResult = Schema.decodeUnknownExit(ProjectRepositories)([{ ...repository, remoteUrl }])
		const zodResult = ProjectRepositoriesSchema.safeParse([{ ...repository, remoteUrl }])
		expect(Exit.isSuccess(effectResult)).toBe(accepted)
		expect(zodResult.success).toBe(accepted)
		expect(
			Exit.isSuccess(Schema.decodeUnknownExit(WorkspaceRepositories)([{ ...workspaceRepository, remoteUrl }])),
		).toBe(accepted)
		expect(WorkspaceRepositoriesSchema.safeParse([{ ...workspaceRepository, remoteUrl }]).success).toBe(accepted)
		if (!zodResult.success) expect(zodResult.error.message).not.toContain('secret-token')
		if (Exit.isFailure(effectResult)) expect(String(effectResult.cause)).not.toContain('secret-token')
	})

	test.each([
		['no remembered sources', { sourceCandidates: [] }, true],
		['filesystem source', { sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: '/checkout' }] }, true],
		['managed source', { sourceCandidates: [{ sourceKind: 'managed_clone', sourcePath: '/managed' }] }, true],
		['missing candidates', {}, false],
		['empty path', { sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: '' }] }, false],
		['unknown source kind', { sourceCandidates: [{ sourceKind: 'automatic', sourcePath: '/checkout' }] }, false],
	])('%s has matching required source-candidate contracts', (_name, value, accepted) => {
		const effectSchema = Schema.Struct({
			sourceCandidates: WorkspaceRepositoryActorSnapshot.fields.sourceCandidates,
		})
		const zodSchema = WorkspaceRepositoryActorSnapshotSchema.pick({ sourceCandidates: true })
		expect(Exit.isSuccess(Schema.decodeUnknownExit(effectSchema)(value))).toBe(accepted)
		expect(zodSchema.safeParse(value).success).toBe(accepted)
	})

	test('normalizes equivalent SSH and HTTPS remotes', () => {
		expect(normalizeRepositoryIdentity('git@github.com:humanlayer/syncopate.git')).toBe(
			'github.com/humanlayer/syncopate',
		)
		expect(normalizeRepositoryIdentity('https://github.com/humanlayer/syncopate.git')).toBe(
			'github.com/humanlayer/syncopate',
		)
		expect(normalizeRepositoryIdentity('ssh://git@github.com/humanlayer/syncopate.git')).toBe(
			'github.com/humanlayer/syncopate',
		)
	})

	test('extracts the repository name from a normalized identity', () => {
		expect(repositoryNameFromIdentity('github.com/humanlayer/syncopate')).toBe('syncopate')
		expect(repositoryNameFromIdentity('gitlab.com/group/subgroup/repository')).toBe('repository')
	})

	test.each([
		['valid recipe', [repository], true],
		['empty recipe', [], false],
		['duplicate identities', [repository, { ...repository, default: false }], false],
		['no default', [{ ...repository, default: false }], false],
		[
			'two defaults',
			[repository, { ...repository, repositoryIdentity: 'github.com/humanlayer/agentlayer' }],
			false,
		],
	])('%s has matching Effect and Zod behavior', (_name, value, accepted) => {
		expect(effectAccepts(value)).toBe(accepted)
		expect(ProjectRepositoriesSchema.safeParse(value).success).toBe(accepted)
	})

	test.each([
		['valid workspace snapshot', [workspaceRepository], true],
		['empty workspace snapshot', [], false],
		['duplicate workspace identities', [workspaceRepository, { ...workspaceRepository, default: false }], false],
		['invalid pinned commit', [{ ...workspaceRepository, baseCommit: 'not-a-commit' }], false],
		['no workspace default', [{ ...workspaceRepository, default: false }], false],
	])('%s has matching workspace Effect and Zod behavior', (_name, value, accepted) => {
		expect(Exit.isSuccess(Schema.decodeUnknownExit(WorkspaceRepositories)(value))).toBe(accepted)
		expect(WorkspaceRepositoriesSchema.safeParse(value).success).toBe(accepted)
	})

	test.each([
		['valid setup-started result', { _tag: 'SetupStarted' }, true],
		[
			'valid stage result',
			{
				_tag: 'WorktreeMaterialized',
				materialization: { kind: 'worktree', path: '/tmp/workspace/syncopate', branch: 'workspace/phase-3' },
			},
			true,
		],
		[
			'invalid stage result',
			{ _tag: 'StageFailed', stage: 'unknown', error: { stage: 'unknown', message: '' } },
			false,
		],
	])('%s has matching setup-result Effect and Zod behavior', (_name, value, accepted) => {
		expect(Exit.isSuccess(Schema.decodeUnknownExit(WorkspaceRepositorySetupResult)(value))).toBe(accepted)
		expect(WorkspaceRepositorySetupResultSchema.safeParse(value).success).toBe(accepted)
	})
})
