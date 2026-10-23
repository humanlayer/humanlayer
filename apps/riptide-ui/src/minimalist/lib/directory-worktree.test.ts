import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { directoryWorktree, useEditInPlace } from '@/minimalist/lib/directory-worktree'
import { resolveWorkspaceReadState } from '@/modules/launcher-v3/launcher-v3-workspace'

const repository = {
	topLevel: '/code/app',
	defaultRemote: 'origin',
	defaultBranch: 'main',
	sourceRef: 'origin/main',
	remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
}

function snapshot(input: {
	repoContent?: string | null
	localContent?: string | null
	inGit?: boolean
	discovered?: boolean
}) {
	return {
		readState: resolveWorkspaceReadState({
			directory: '/code/app',
			repoContent: input.repoContent ?? null,
			localContent: input.localContent ?? null,
			selectedRepository: input.discovered ? (repository as never) : undefined,
		}),
		isInsideGitRepository: input.inGit ?? true,
	}
}

describe('directoryWorktree', () => {
	it('implies a single-repository workspace.json for a repository with none', () => {
		const result = directoryWorktree('/code/app', snapshot({ discovered: true }))
		expect(result).toMatchObject({ kind: 'available', configured: false, repositories: 1 })
		if (result.kind !== 'available') throw new Error('expected a worktree')
		const planned = result.plan('fix-login-0001')
		expect(planned.workspaceSpec.repos).toMatchObject([
			{ localPath: '.', branch: 'fix-login-0001', sourceRef: 'origin/main', primary: true },
		])
		expect(planned.defaultWorkingDirectory).toContain('fix-login-0001')
	})

	it('sets up every repository workspace.json lists', () => {
		const config = JSON.stringify({ repos: [{ localPath: '.', primary: true }, { localPath: '../lib' }] })
		const result = directoryWorktree('/code/app', snapshot({ repoContent: config }))
		expect(result).toMatchObject({ kind: 'available', configured: true, repositories: 2 })
		if (result.kind !== 'available') throw new Error('expected a worktree')
		expect(result.plan('t-1').workspaceSpec.repos.map((repo) => repo.localPath)).toEqual(['.', '../lib'])
	})

	it('prefixes implied branches from Settings → Git but keeps a configured branchTemplate', () => {
		const implied = directoryWorktree('/code/app', snapshot({ discovered: true }), 'dex/')
		if (implied.kind !== 'available') throw new Error('expected a worktree')
		expect(implied.plan('t-1').workspaceSpec.repos[0]?.branch).toBe('dex/t-1')
		const config = JSON.stringify({ branchTemplate: 'wt/{{ TASKSLUG }}' })
		const configured = directoryWorktree('/code/app', snapshot({ repoContent: config }), 'dex/')
		if (configured.kind !== 'available') throw new Error('expected a worktree')
		expect(configured.plan('t-1').workspaceSpec.repos[0]?.branch).toBe('wt/t-1')
	})

	it('sets up the repositories workspace.json lists in a directory outside Git', () => {
		const config = JSON.stringify({ repos: [{ localPath: 'app', primary: true }, { localPath: 'lib' }] })
		const result = directoryWorktree('/code', snapshot({ repoContent: config, inGit: false }))
		expect(result).toMatchObject({ kind: 'available', configured: true, repositories: 2 })
	})

	it('edits a directory outside Git in place', () => {
		expect(directoryWorktree('/code/app', snapshot({ inGit: false }))).toEqual({
			kind: 'unavailable',
			reason: null,
		})
	})

	it('says why when workspace.json turns worktrees off or cannot be read', () => {
		expect(directoryWorktree('/code/app', snapshot({ repoContent: '{"disabled": true}' }))).toMatchObject({
			kind: 'unavailable',
			reason: expect.stringContaining('disabled'),
		})
		expect(directoryWorktree('/code/app', snapshot({ repoContent: '{' }))).toMatchObject({
			kind: 'unavailable',
			reason: expect.stringContaining('workspace.json'),
		})
	})
})

describe('useEditInPlace', () => {
	it('remembers the in-place choice for each directory', () => {
		const app = renderHook(() => useEditInPlace('/code/app'))
		const other = renderHook(() => useEditInPlace('/code/other'))
		expect(app.result.current[0]).toBe(false)
		act(() => app.result.current[1](true))
		expect(app.result.current[0]).toBe(true)
		expect(other.result.current[0]).toBe(false)
		expect(renderHook(() => useEditInPlace('/code/app')).result.current[0]).toBe(true)
		act(() => app.result.current[1](false))
		expect(app.result.current[0]).toBe(false)
	})
})
