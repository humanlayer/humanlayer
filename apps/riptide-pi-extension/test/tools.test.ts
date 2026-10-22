// The HumanLayer comment and research tools (plan-part-2.md phase 1): their output text, when
// they are on, and the daemon-plane calls they make for the bound task.

import assert from 'node:assert/strict'
import test from 'node:test'

import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'

import type { ArtifactComment, DiffThread } from '../src/api.ts'
import { formatArtifactComments, formatDiffComments, HUMANLAYER_TOOLS } from '../src/tools.ts'
import { setUp, type TestSession, waitFor } from './helpers/harness.ts'
import type { MockCloud } from './helpers/mock-cloud.ts'

function comment(over: Partial<ArtifactComment>): ArtifactComment {
	return {
		id: 'c1',
		truncatedId: 'aaaaaaaaaaaa',
		userName: 'Dex',
		isResolved: false,
		createdByAgent: false,
		contentText: 'fix this',
		quotedText: null,
		previousBlockText: null,
		nextBlockText: null,
		replyToCommentId: null,
		...over,
	}
}

function thread(over: Partial<DiffThread> = {}): DiffThread {
	const root = {
		id: 'd1',
		truncatedId: 'bbbbbbbbbbbb',
		createdByUserId: 'user_1',
		createdByAgent: false,
		contentText: 'use <b> & "quotes"',
		isDeleted: false,
	}
	return {
		root,
		replies: [],
		anchor: {
			v: 1,
			repoId: 'work',
			path: 'src/a.ts',
			patchHash: 'ph',
			start: { side: 'new', line: 3 },
			end: { side: 'new', line: 4 },
		},
		isResolved: false,
		...over,
	}
}

/** The text of the tool_result event for a tool call id. */
function result(cloud: MockCloud, id: string): string | undefined {
	for (const s of cloud.sessions()) {
		const e = cloud.events(s.id).find((x) => x.eventType === 'tool_result' && x.toolResultForId === id)
		if (e) return e.toolResultContent
	}
	return undefined
}

function active(s: TestSession): string[] {
	return s.session.getActiveToolNames().filter((n) => (HUMANLAYER_TOOLS as readonly string[]).includes(n))
}

test('artifact comments print threads with their block context and replies', () => {
	const text = formatArtifactComments(
		'plan.md',
		[
			comment({ previousBlockText: 'before', quotedText: 'the line', nextBlockText: 'after' }),
			comment({
				id: 'c2',
				truncatedId: 'cccccccccccc',
				userName: 'Agent',
				contentText: 'done',
				replyToCommentId: 'c1',
			}),
			comment({ id: 'c3', truncatedId: 'dddddddddddd', isResolved: true, contentText: 'old' }),
		],
		0,
		20,
	)
	assert.equal(
		text,
		[
			'<comments for="plan.md">',
			'<comment id="aaaaaaaaaaaa">',
			'  | before',
			'> | the line',
			'  | after',
			'',
			'Dex: fix this',
			'  Agent: done',
			'</comment>',
			'',
			'<comment id="dddddddddddd">',
			'Dex [RESOLVED]: old',
			'</comment>',
			'</comments>',
		].join('\n'),
	)
	assert.equal(formatArtifactComments('plan.md', [], 0, 20), 'No comments found on plan.md')
})

test('diff comments escape XML and say how many threads were left out', () => {
	const text = formatDiffComments([thread(), thread({ isResolved: true })], 0, 1)
	assert.equal(
		text,
		[
			'<diff_comments>',
			'<diff_comment id="bbbbbbbbbbbb" repo="work" path="src/a.ts" patch_hash="ph" start_side="new" start_line="3" end_side="new" end_line="4" resolved="false">',
			'  <comment id="bbbbbbbbbbbb" author="user_1">use &lt;b&gt; &amp; &quot;quotes&quot;</comment>',
			'</diff_comment>',
			'</diff_comments>',
			'(1 additional threads not returned)',
		].join('\n'),
	)
	assert.equal(formatDiffComments([], 0, 20), 'No diff comments found for this task')
})

test('the tools stay off until the session links to a task', async (t) => {
	const { open } = await setUp(t, 'none')
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('hi')])
	await s.session.prompt('hello')
	assert.deepEqual(active(s), [])
})

test('the first prompt can call a tool, which waits for the bind and calls the daemon plane', async (t) => {
	const { cloud, open } = await setUp(t)
	cloud.stub('comments/get', {
		artifactFilename: 'plan.md',
		comments: [comment({ quotedText: 'step 1' })],
	})
	const s = await open()
	s.faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall('get_artifact_comments', { artifact_filename: 'plan.md' }, { id: 'call_1' }),
			{
				stopReason: 'toolUse',
			},
		),
		fauxAssistantMessage('read them'),
	])

	await s.session.prompt('address the review comments')
	assert.deepEqual(active(s), [...HUMANLAYER_TOOLS])
	await waitFor('the tool result', () => result(cloud, 'call_1') !== undefined)

	const call = cloud.requests.find((r) => r.path === '/rpc/daemon/v1/comments/get')
	assert.ok(call, 'comments/get was called')
	assert.equal(call.status, 200)
	assert.deepEqual(call.body, { taskId: cloud.tasks()[0]?.id, artifactFilename: 'plan.md', includeResolved: true })
	assert.match(result(cloud, 'call_1') ?? '', /^<comments for="plan.md">\n<comment id="aaaaaaaaaaaa">\n> \| step 1/)
})

test('a missing artifact lists the valid ones, and each tool posts its route', async (t) => {
	const { cloud, open } = await setUp(t)
	cloud.fail({ route: 'comments/reply', status: 404, data: { validArtifacts: ['plan.md', 'research.md'] } })
	cloud.stub('diffComments/reply', { success: true, commentId: '00000000-0000-0000-0000-123456789abc' })
	cloud.stub('diffComments/update', {
		success: true,
		updated: [{}],
		failed: [{ truncatedId: 'ffffffff', reason: 'forbidden' }],
	})
	cloud.stub('agents/research', { success: true, response: 'use the thing' })
	const s = await open()
	const call = (name: string, args: Parameters<typeof fauxToolCall>[1], id: string) =>
		fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' })
	s.faux.setResponses([
		call(
			'reply_to_artifact_comment',
			{ artifact_filename: 'nope.md', comment_id: 'aaaaaaaa', content: 'hi' },
			'c1',
		),
		call('reply_to_diff_comment', { thread_id: 'abcdef12', content: ' ok ' }, 'c2'),
		call('update_diff_comments', { comment_ids: ['abcdef12', 'ffffffff'], resolved: true }, 'c3'),
		call('update_diff_comments', { comment_ids: ['abcdef12'] }, 'c4'),
		call('library_researcher', { question: 'q', package_name: 'p', language: 'ts' }, 'c5'),
		fauxAssistantMessage('done'),
	])

	await s.session.prompt('go')
	await waitFor('every tool result', () =>
		['c1', 'c2', 'c3', 'c4', 'c5'].every((id) => result(cloud, id) !== undefined),
	)

	assert.equal(result(cloud, 'c1'), 'Artifact not found. Valid artifacts: plan.md, research.md')
	assert.equal(result(cloud, 'c2'), 'Reply added (id: 123456789abc)')
	assert.equal(result(cloud, 'c3'), 'Updated 1 comment(s). Failed: ffffffff: forbidden')
	assert.equal(result(cloud, 'c4'), 'At least one of resolved or deleted must be provided')
	assert.equal(result(cloud, 'c5'), 'use the thing')

	const taskId = cloud.tasks()[0]?.id
	const body = (tail: string) => cloud.requests.find((r) => r.path === `/rpc/daemon/v1/${tail}`)?.body
	assert.deepEqual(body('diffComments/reply'), { taskId, truncatedCommentId: 'abcdef12', contentText: 'ok' })
	assert.deepEqual(body('diffComments/update'), {
		taskId,
		truncatedCommentIds: ['abcdef12', 'ffffffff'],
		resolved: true,
	})
	assert.deepEqual(body('agents/research'), { question: 'q', packageName: 'p', language: 'ts' })
	assert.equal(cloud.requests.filter((r) => r.path.endsWith('/diffComments/update')).length, 1, 'c4 never left pi')
})
