import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import {
	FileMatch,
	FilesystemOperationError,
	WorkspaceConfigError,
	WorkspaceConfigReadResult,
} from '../src/desktop-rpc.js'

describe('workspace and filesystem contracts', () => {
	it('decodes filesystem matches and workspace reads', async () => {
		const match = {
			path: '/repo/src/index.ts',
			display_path: 'src/index.ts',
			score: 42,
			matched_indexes: [0, 1],
			is_directory: false,
		}
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(FileMatch)(match))).resolves.toEqual(match)
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(WorkspaceConfigReadResult)({ content: null, exists: false })),
		).resolves.toEqual({ content: null, exists: false })
		const repositoryRead = {
			content: null,
			exists: false,
			isInsideGitRepository: true,
			selectedRepository: {
				path: '/repo',
				name: 'repo',
				remotes: [{ name: 'origin', url: 'git@example.com:acme/repo.git' }],
				defaultRemote: 'origin',
				defaultBranch: 'trunk',
				sourceRef: 'origin/trunk',
			},
		}
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(WorkspaceConfigReadResult)(repositoryRead)),
		).resolves.toEqual(repositoryRead)
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(Schema.Uint8Array)(new Uint8Array([1, 2, 3]))),
		).resolves.toEqual(new Uint8Array([1, 2, 3]))
	})

	it('rejects malformed payload values', async () => {
		await expect(
			Effect.runPromise(
				Schema.decodeUnknownEffect(FileMatch)({
					path: '/repo',
					display_path: 'repo',
					score: 'high',
					matched_indexes: [],
					is_directory: true,
				}),
			),
		).rejects.toBeDefined()
	})

	it('preserves tagged operation errors', () => {
		expect(new FilesystemOperationError({ operation: 'stat', path: '/missing', message: 'missing' })).toMatchObject(
			{
				_tag: 'FilesystemOperationError',
			},
		)
		expect(new WorkspaceConfigError({ operation: 'write', path: '/repo', message: 'denied' })).toMatchObject({
			_tag: 'WorkspaceConfigError',
		})
	})
})
