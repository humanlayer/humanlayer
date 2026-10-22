import { describe, expect, it, vi } from 'vitest'

import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { freshWork, linkRequest, scrollOnce } from '@/minimalist/lib/thread-panel'
import type { EventRow } from '@/minimalist/lib/transcript'

const call = (tool_name: string, tool_input_json: unknown, created_at: number) =>
	({ id: `e${created_at}`, event_type: 'tool_call', tool_name, tool_input_json, created_at }) as EventRow

const doc = (id: string, file_name: string, last_updated_at: number) =>
	({ id, file_name, last_updated_at }) as unknown as TaskArtifact

describe('freshWork', () => {
	const edit = call('Edit', { file_path: '/r/a.ts' }, 20)

	it('opens a document the agent wrote since you opened the thread, ahead of its edits', () => {
		expect(freshWork([edit], [doc('old', 'plan.md', 5), doc('new', 'research.md', 30)], 10, true)).toBe(
			'artifact:new',
		)
	})

	it('opens Review for files changed since you opened the thread, when the task has a diff', () => {
		expect(freshWork([edit], [], 10, true)).toBe('review')
		expect(freshWork([edit], [], 10, false)).toBeNull()
		expect(freshWork([edit], [], 25, true)).toBeNull()
	})

	it('waits for an approved call before opening Review', () => {
		const ask = (approval_status: EventRow['approval_status']) => ({ ...edit, approval_status })
		expect(freshWork([ask('pending')], [], 10, true)).toBeNull()
		expect(freshWork([ask('denied')], [], 10, true)).toBeNull()
		expect(freshWork([ask('approved')], [], 10, true)).toBe('review')
	})

	it('counts shell commands that write files, not ones that only read', () => {
		expect(freshWork([call('Bash', { command: 'touch scratch/e.txt' }, 20)], [], 10, true)).toBe('review')
		expect(freshWork([call('Bash', { command: 'ls scratch' }, 20)], [], 10, true)).toBeNull()
	})

	it('ignores the task prompt and attachments', () => {
		expect(freshWork([], [doc('p', 'task.md', 30), doc('i', 'shot.png', 30)], 10, true)).toBeNull()
	})
})

describe('linkRequest', () => {
	it('opens the linked document and comment, or Review on a linked diff comment', () => {
		const artifacts = [{ id: 'a1' }]
		expect(linkRequest({ artifactId: 'a1' }, artifacts, true)).toEqual({ tab: 'artifact:a1' })
		expect(linkRequest({ artifactId: 'a1', commentId: 'c1' }, artifacts, true)).toEqual({
			tab: 'artifact:a1',
			comment: 'c1',
		})
		expect(linkRequest({ diffFileId: 'f1', diffCommentId: 'c1' }, artifacts, true)).toEqual({
			tab: 'review',
			file: 'f1',
			comment: 'c1',
		})
	})

	it("reads the standard UI's copied links, which name the comment `comment`", () => {
		expect(linkRequest({ artifactId: 'a1', comment: 'c1' }, [{ id: 'a1' }], true)).toEqual({
			tab: 'artifact:a1',
			comment: 'c1',
		})
	})

	it('ignores documents the task lacks and diff links in tasks without a diff', () => {
		expect(linkRequest({ artifactId: 'gone' }, [], true)).toBeNull()
		expect(linkRequest({ diffCommentId: 'c1' }, [], false)).toBeNull()
	})
})

describe('scrollOnce', () => {
	it('scrolls once per request, however often the element mounts', () => {
		const element = { scrollIntoView: vi.fn() } as unknown as HTMLElement
		const first = {}
		scrollOnce(first, 'center')(element)
		scrollOnce(first, 'center')(element)
		expect(element.scrollIntoView).toHaveBeenCalledTimes(1)
		scrollOnce({}, 'center')(element)
		scrollOnce(null, 'center')(element)
		expect(element.scrollIntoView).toHaveBeenCalledTimes(2)
	})
})
