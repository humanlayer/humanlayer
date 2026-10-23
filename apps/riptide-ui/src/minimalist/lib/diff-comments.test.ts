import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import { describe, expect, it } from 'vitest'

import {
	authorPerson,
	type DiffThread,
	diffCommentsMessage,
	fileThreads,
	lineThreads,
	parseDiffCommentMessage,
	threadFileId,
	threadOf,
	threadPlace,
} from '@/minimalist/lib/diff-comments'

const comment = (over: Partial<DiffComment> & { author?: { firstName?: string; email: string } }) =>
	({
		id: '01a0e4ae-3e17-77f8-a0b2-b7c2984a0993',
		task_id: 't1',
		reply_to_comment_id: null,
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Use a constant',
		anchor_json: {
			v: 1,
			repoId: 'r1',
			path: 'src/app.ts',
			patchHash: 'h1',
			start: { side: 'new', line: 4 },
			end: { side: 'new', line: 4 },
		},
		is_resolved: false,
		is_deleted: false,
		created_by_user_id: 'u1',
		created_by_agent: false,
		author: { firstName: 'Ada', email: 'ada@example.com' },
		...over,
	}) as DiffThread['root']

const thread = (placement: DiffThread['placement'], root = comment({})): DiffThread => ({
	root,
	replies: [],
	placement,
})

describe('lineThreads and fileThreads', () => {
	it('puts line threads on their line and the rest above the file', () => {
		const onLine = thread({ status: 'current', fileId: 'f1', side: 'new', line: 4 })
		const moved = thread({ status: 'outdated-inline', fileId: 'f1', side: 'new', line: 4 })
		const gone = thread({ status: 'outdated-file', fileId: 'f1' })
		const elsewhere = thread({ status: 'current', fileId: 'f2', side: 'new', line: 4 })
		const all = [onLine, moved, gone, elsewhere]
		expect(lineThreads(all, 'f1')).toEqual([
			{ thread: onLine, side: 'new', line: 4 },
			{ thread: moved, side: 'new', line: 4 },
		])
		expect(fileThreads(all, 'f1')).toEqual([gone])
	})
})

describe('threadOf and threadFileId', () => {
	it('finds a thread by its root or a reply, and the file it sits in', () => {
		const reply = comment({ id: 'reply', reply_to_comment_id: 'root' })
		const onLine = { ...thread({ status: 'current', fileId: 'f1', side: 'new', line: 4 }), replies: [reply] }
		const missing = thread({ status: 'file-missing', repoId: 'r1', path: 'gone.ts' }, comment({ id: 'other' }))
		expect(threadOf([onLine, missing], 'reply')).toBe(onLine)
		expect(threadOf([onLine, missing], 'other')).toBe(missing)
		expect(threadOf([onLine, missing], 'nope')).toBeUndefined()
		expect(threadFileId(onLine)).toBe('f1')
		expect(threadFileId(missing)).toBeUndefined()
	})
})

describe('threadPlace', () => {
	it('labels threads that no longer sit on a current line', () => {
		expect(threadPlace(thread({ status: 'current', fileId: 'f1', side: 'new', line: 4 }))).toBeNull()
		expect(threadPlace(thread({ status: 'outdated-file', fileId: 'f1' }))).toBe('Line 4 · outdated')
		expect(threadPlace(thread({ status: 'file-missing', repoId: 'r1', path: 'src/app.ts' }))).toBe('src/app.ts:4')
	})
})

describe('authorPerson', () => {
	it('uses the full name, else the email, and marks what the agent wrote', () => {
		expect(authorPerson(comment({}))).toMatchObject({ name: 'Ada', agent: false })
		expect(authorPerson(comment({ created_by_agent: true }))).toMatchObject({ name: 'Ada', agent: true })
		expect(authorPerson(comment({ author: { email: 'bo@example.com' } })).name).toBe('bo@example.com')
	})
})

describe('diffCommentsMessage and parseDiffCommentMessage', () => {
	it('reads the sent message back as a short list per file', () => {
		const current = thread(
			{ status: 'current', fileId: 'f1', side: 'new', line: 4 },
			comment({ content_text: 'Use <T> & friends' }),
		)
		const message = diffCommentsMessage([current])
		expect(message.rootCommentIds).toEqual([current.root.id])
		expect(parseDiffCommentMessage(message.text)).toEqual({
			file: 'app.ts',
			comments: [{ quote: 'src/app.ts:4', lines: ['Ada: Use <T> & friends'] }],
		})
	})

	it('drops the outdated hint and names no file when comments span several', () => {
		const outdated = thread(
			{ status: 'outdated-file', fileId: 'f2' },
			comment({ id: 'b', anchor_json: { ...comment({}).anchor_json!, path: 'src/b.ts' } }),
		)
		const sent = parseDiffCommentMessage(
			diffCommentsMessage([thread({ status: 'current', fileId: 'f1', side: 'new', line: 4 }), outdated]).text,
		)
		expect(sent?.file).toBeNull()
		expect(sent?.comments.map((entry) => entry.lines)).toEqual([['Ada: Use a constant'], ['Ada: Use a constant']])
	})

	it('leaves out the selected lines the agent gets', () => {
		const anchor = { ...comment({}).anchor_json!, selectedDiff: '-const a = 1\n+const a = 2' }
		const sent = parseDiffCommentMessage(
			diffCommentsMessage([
				thread({ status: 'current', fileId: 'f1', side: 'new', line: 4 }, comment({ anchor_json: anchor })),
			]).text,
		)
		expect(sent?.comments).toEqual([{ quote: 'src/app.ts:4', lines: ['Ada: Use a constant'] }])
	})

	it('leaves ordinary messages alone', () => {
		expect(parseDiffCommentMessage('Fix the tests')).toBeNull()
	})
})
