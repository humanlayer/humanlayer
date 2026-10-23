import { beforeEach, describe, expect, it } from 'vitest'

import {
	getLastTaskLauncherWorkingDir,
	getLastTaskLauncherLocation,
	getLastSessionWorkingDir,
	setLastTaskLauncherWorkingDir,
	setLastTaskLauncherLocation,
	setLastSessionWorkingDir,
} from './preferences'

describe('working directory preferences', () => {
	beforeEach(() => localStorage.clear())

	it('keeps task-launcher directories separate from session directories', () => {
		setLastTaskLauncherWorkingDir('host-1', '/projects/syncopate')
		setLastSessionWorkingDir('host-1', 'task-1', '/projects/syncopate-worktree')

		expect(getLastTaskLauncherWorkingDir('host-1')).toBe('/projects/syncopate')
		expect(getLastSessionWorkingDir('host-1', 'task-1')).toBe('/projects/syncopate-worktree')
	})

	it('keeps task-launcher directories scoped by host', () => {
		setLastTaskLauncherWorkingDir('host-1', '/projects/one')
		setLastTaskLauncherWorkingDir('host-2', '/projects/two')

		expect(getLastTaskLauncherWorkingDir('host-1')).toBe('/projects/one')
		expect(getLastTaskLauncherWorkingDir('host-2')).toBe('/projects/two')
	})

	it('remembers the latest task-launcher project or directory before launch', () => {
		setLastTaskLauncherLocation('host-1', { type: 'project', projectId: 'project-1' })
		expect(getLastTaskLauncherLocation('host-1')).toEqual({ type: 'project', projectId: 'project-1' })

		setLastTaskLauncherWorkingDir('host-1', '/projects/next')
		expect(getLastTaskLauncherLocation('host-1')).toEqual({
			type: 'directory',
			directory: '/projects/next',
		})
	})

	it('reads the previous working-directory preference as a launcher location', () => {
		localStorage.setItem('riptide-last-task-launcher-working-dir-host-1', '/projects/legacy')

		expect(getLastTaskLauncherLocation('host-1')).toEqual({
			type: 'directory',
			directory: '/projects/legacy',
		})
	})

	it('keeps session directories scoped by host and task', () => {
		setLastSessionWorkingDir('host-1', 'task-1', '/worktrees/one')
		setLastSessionWorkingDir('host-1', 'task-2', '/worktrees/two')
		setLastSessionWorkingDir('host-2', 'task-1', '/remote/one')

		expect(getLastSessionWorkingDir('host-1', 'task-1')).toBe('/worktrees/one')
		expect(getLastSessionWorkingDir('host-1', 'task-2')).toBe('/worktrees/two')
		expect(getLastSessionWorkingDir('host-2', 'task-1')).toBe('/remote/one')
	})
})
