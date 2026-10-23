import { Exit } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import { WorkspaceSetupErrorSchema as EffectWorkspaceSetupErrorSchema } from '../src/effect/workspace/workspace-setup-error'
import { WorkspaceSetupStateSchema as EffectWorkspaceSetupStateSchema } from '../src/effect/workspace/workspace-setup-state'
import { WorkspaceSpecSchema as EffectWorkspaceSpecSchema } from '../src/effect/workspace/workspace-spec'
import { WorkspaceSetupErrorSchema as ZodWorkspaceSetupErrorSchema } from '../src/zod/workspace/workspace-setup-error'
import { WorkspaceSetupStateSchema as ZodWorkspaceSetupStateSchema } from '../src/zod/workspace/workspace-setup-state'
import { WorkspaceSpecSchema as ZodWorkspaceSpecSchema } from '../src/zod/workspace/workspace-spec'

const fullWorkspaceSpec = {
	specVersion: 1,
	directory: '~/projects/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/eng-1234',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/eng-1234/syncopate',
			branch: 'eng-1234',
			sourceRef: 'origin/main',
			branchRemote: 'origin',
			sourceCommit: 'a'.repeat(40),
			setupCommand: 'bun install',
			copyGlobs: ['.env'],
			primary: true,
		},
	],
}

const fullWorkspaceSetupState = {
	specVersion: 1,
	startedAt: 1_000,
	repos: [
		{
			localPath: '.',
			status: 'setup_command',
			preflight: { resolvedSourceCommit: 'abc123', branchRemote: 'origin' },
			worktree: {
				targetPath: '/tmp/eng-1234/syncopate',
				remoteName: 'origin',
				remoteUrl: 'git@example.com:repo.git',
				upstreamRef: 'origin/eng-1234',
				published: true,
			},
			copyGlobs: { filesCopied: ['.env'] },
			setupCommand: { command: 'bun install', exitCode: 1 },
		},
	],
	acceptedSkips: [
		{
			localPath: '.',
			stage: 'copy_globs',
			skippedByUserId: 'user-1',
			skippedAt: 2_000,
			errorMessage: 'missing optional file',
		},
	],
}

const fullWorkspaceSetupError = {
	localPath: '.',
	stage: 'setup_command',
	message: 'Setup command failed',
	command: 'bun install',
	exitCode: 1,
	stderr: 'lockfile mismatch',
}

const decodeEffect = <S extends Schema.ConstraintDecoder<unknown, never>>(
	schema: S,
	value: unknown,
): { success: boolean; value?: S['Type'] } => {
	const exit = Schema.decodeUnknownExit(schema)(value)
	return Exit.match(exit, {
		onFailure: () => ({ success: false }),
		onSuccess: (decoded) => ({ success: true, value: decoded }),
	})
}

describe('workspace Zod and Effect schema parity', () => {
	test('accepts the same valid workspace fixtures and defaults', () => {
		for (const fixture of [
			fullWorkspaceSpec,
			{
				directory: '~/projects/syncopate',
				workspaceBaseDirectory: '~/.humanlayer/workspaces/eng-1234',
				repos: [
					{
						localPath: '.',
						targetPath: '/tmp/syncopate',
						branch: 'eng-1234',
						sourceRef: 'origin/main',
						primary: true,
					},
				],
			},
		]) {
			const zodParsed = ZodWorkspaceSpecSchema.parse(fixture)
			const effectParsed = decodeEffect(EffectWorkspaceSpecSchema, fixture)
			expect(effectParsed).toEqual({ success: true, value: zodParsed })
		}

		for (const fixture of [fullWorkspaceSetupState, { specVersion: 1, repos: [] }]) {
			const zodParsed = ZodWorkspaceSetupStateSchema.parse(fixture)
			const effectParsed = decodeEffect(EffectWorkspaceSetupStateSchema, fixture)
			expect(effectParsed).toEqual({ success: true, value: zodParsed })
		}

		const zodParsed = ZodWorkspaceSetupErrorSchema.parse(fullWorkspaceSetupError)
		const effectParsed = decodeEffect(EffectWorkspaceSetupErrorSchema, fullWorkspaceSetupError)
		expect(effectParsed).toEqual({ success: true, value: zodParsed })
	})

	test('rejects the same invalid workspace fixtures', () => {
		const invalidSpecFixtures = [
			{ ...fullWorkspaceSpec, specVersion: 0 },
			{ ...fullWorkspaceSpec, repos: [{ ...fullWorkspaceSpec.repos[0], localPath: '' }] },
			{ ...fullWorkspaceSpec, repos: [{ ...fullWorkspaceSpec.repos[0], primary: false }] },
			{ ...fullWorkspaceSpec, repos: [{ ...fullWorkspaceSpec.repos[0], sourceCommit: 'origin/main' }] },
		]
		for (const fixture of invalidSpecFixtures) {
			expect(ZodWorkspaceSpecSchema.safeParse(fixture).success).toBe(false)
			expect(decodeEffect(EffectWorkspaceSpecSchema, fixture).success).toBe(false)
		}

		const invalidStateFixtures = [
			{ ...fullWorkspaceSetupState, startedAt: -1 },
			{ ...fullWorkspaceSetupState, repos: [{ ...fullWorkspaceSetupState.repos[0], status: 'failed' }] },
			{
				...fullWorkspaceSetupState,
				repos: [
					{ ...fullWorkspaceSetupState.repos[0], setupCommand: { command: 'bun install', exitCode: 1.5 } },
				],
			},
		]
		for (const fixture of invalidStateFixtures) {
			expect(ZodWorkspaceSetupStateSchema.safeParse(fixture).success).toBe(false)
			expect(decodeEffect(EffectWorkspaceSetupStateSchema, fixture).success).toBe(false)
		}

		const invalidErrorFixtures = [
			{ ...fullWorkspaceSetupError, message: '' },
			{ ...fullWorkspaceSetupError, stage: 'failed' },
			{ ...fullWorkspaceSetupError, exitCode: 1.5 },
		]
		for (const fixture of invalidErrorFixtures) {
			expect(ZodWorkspaceSetupErrorSchema.safeParse(fixture).success).toBe(false)
			expect(decodeEffect(EffectWorkspaceSetupErrorSchema, fixture).success).toBe(false)
		}
	})
})
