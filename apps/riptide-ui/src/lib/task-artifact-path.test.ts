import { describe, expect, test } from 'vitest'

import {
	getTaskArtifactScope,
	isBrowserLoadableImageUrl,
	parseTaskArtifactPath,
	TASK_ARTIFACT_MENTION_PATTERN,
	toTaskArtifactReference,
} from './task-artifact-path'

function mentionedPaths(text: string): string[] {
	return [...text.matchAll(TASK_ARTIFACT_MENTION_PATTERN)].map((match) => match[1] ?? '')
}

describe('parseTaskArtifactPath', () => {
	test.each([
		['.humanlayer/tasks/my-task/plan.md', { taskSlug: 'my-task', fileName: 'plan.md' }],
		['@.humanlayer/tasks/my-task/plan.md', { taskSlug: 'my-task', fileName: 'plan.md' }],
		['/home/me/repo/.humanlayer/tasks/my-task/shots/a.png', { taskSlug: 'my-task', fileName: 'shots/a.png' }],
		['~/.humanlayer/riptide/artifacts/task-123/a.png', { taskId: 'task-123', fileName: 'a.png' }],
	])('parses %j', (path, expected) => {
		expect(parseTaskArtifactPath(path)).toEqual(expected)
	})

	test.each(['./after.png', '/tmp/shot.png', 'https://example.test/.humanlayer/tasks', 'plan.md'])(
		'ignores %j',
		(path) => {
			expect(parseTaskArtifactPath(path)).toBeNull()
		},
	)

	test('falls back to a file name in the current task', () => {
		expect(toTaskArtifactReference(' mockup.html ')).toEqual({ fileName: 'mockup.html' })
	})
})

describe('isBrowserLoadableImageUrl', () => {
	test.each([
		'https://example.test/a.png',
		'http://localhost/a.png',
		'data:image/png;base64,AA',
		'blob:abc',
		'//cdn.test/a.png',
	])('loads %j in the browser', (url) => {
		expect(isBrowserLoadableImageUrl(url)).toBe(true)
	})

	test.each(['/tmp/shots/a.png', './a.png', 'a.png', '~/a.png', 'file:///tmp/a.png'])(
		'treats %j as a host file',
		(url) => {
			expect(isBrowserLoadableImageUrl(url)).toBe(false)
		},
	)
})

describe('getTaskArtifactScope', () => {
	test('looks up a path that names a task in that task only', () => {
		expect(getTaskArtifactScope({ taskSlug: 'other-task', fileName: 'plan.md' }, 'route-task')).toEqual({
			column: 'task_slug',
			value: 'other-task',
		})
	})

	test('uses the task id from a storage path before the route task', () => {
		expect(getTaskArtifactScope({ taskId: 'task-1', fileName: 'a.png' }, 'route-task')).toEqual({
			column: 'task_id',
			value: 'task-1',
		})
	})

	test('falls back to the route task for a bare file name', () => {
		expect(getTaskArtifactScope({ fileName: 'mockup.html' }, 'route-task')).toEqual({
			column: 'task_id',
			value: 'route-task',
		})
		expect(getTaskArtifactScope({ fileName: 'mockup.html' }, undefined)).toBeNull()
	})
})

describe('TASK_ARTIFACT_MENTION_PATTERN', () => {
	test('stops at the end of the file name', () => {
		expect(mentionedPaths('you can check @.humanlayer/tasks/slug-ck1673/slice-2-plan.md\nyes')).toEqual([
			'.humanlayer/tasks/slug-ck1673/slice-2-plan.md',
		])
	})

	test('keeps spaces in macOS screenshot names', () => {
		expect(mentionedPaths('look\n\n@.humanlayer/tasks/slug/Screenshot 2026-10-04 at 15.29.14.png')).toEqual([
			'.humanlayer/tasks/slug/Screenshot 2026-10-04 at 15.29.14.png',
		])
	})

	test('finds several mentions and leaves sentence punctuation outside', () => {
		expect(mentionedPaths('compare @.humanlayer/tasks/a/one.md and @.humanlayer/tasks/a/two words.html.')).toEqual([
			'.humanlayer/tasks/a/one.md',
			'.humanlayer/tasks/a/two words.html',
		])
	})

	test('ignores mentions outside a task directory', () => {
		expect(mentionedPaths('see @apps/riptide-ui/src/main.tsx')).toEqual([])
	})
})
