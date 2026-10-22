// Share, Steer, Collaborate, Trust and approvals: the task folder and diff, web messages and stops,
// the HumanLayer tools, approvals answered on either side, crash recovery and resume.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { assistant, type Env, type FakeClaude, setUp, toolResult, waitFor } from './helpers/claude.ts'

function messages(env: Env, id: string, role: 'user' | 'assistant'): string[] {
	return env.cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === role)
		.map((e) => String(e.content))
}

async function bound(env: Env, c: FakeClaude, text = 'hello'): Promise<string> {
	const before = env.cloud.sessions().length
	await c.turn(text, 'ok')
	await waitFor('the bind', () => env.cloud.sessions().length > before)
	const id = env.cloud.sessions().at(-1)?.id ?? ''
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	return id
}

/** The inbox made a live shape request, so later row changes count as news. */
async function following(env: Env): Promise<void> {
	await waitFor('a live sync request', () =>
		env.cloud.requests.some(
			(r) => r.plane === 'sync' && (r.body as { live?: string | null } | undefined)?.live === 'true',
		),
	)
}

function orgOf(env: Env): string {
	return env.cloud.state.orgs[0]?.internalOrgId ?? ''
}

// ---- Share ----

test('the task folder links, its section reaches the system prompt, and files written there sync', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	const folder = join(env.repo, '.humanlayer', 'tasks', slug)
	await waitFor('the task folder link', () => existsSync(folder))
	await waitFor('the git exclude', () =>
		readFileSync(join(env.repo, '.git', 'info', 'exclude'), 'utf8').includes('.humanlayer'),
	)

	const hint = await c.hint()
	assert.ok(hint?.includes(`.humanlayer/tasks/${slug}`))
	assert.match(hint ?? '', /task-artifact/)
	// Once the cloud session exists, the section gives its link, so the agent can open it when asked.
	assert.ok(hint?.includes(`The user can follow this session in HumanLayer at http://app.test/sessions/${id}`))

	writeFileSync(join(folder, 'plan.md'), '# Plan\n')
	c.append(
		assistant(c.uuid(), 'msg_w', [
			{
				type: 'tool_use',
				id: 'toolu_w',
				name: 'Write',
				input: { file_path: join(folder, 'plan.md'), content: '# Plan\n' },
			},
		]),
	)
	c.append(toolResult(c.uuid(), 'toolu_w', `File created successfully at: ${join(folder, 'plan.md')}`))
	await c.event({ kind: 'rows' })
	await waitFor('plan.md', () => env.cloud.artifacts(taskId).some((a) => a.fileName === 'plan.md'))
	await waitFor('the Write call', () =>
		env.cloud.events(id).some((e) => e.eventType === 'tool_call' && e.toolCallId === 'toolu_w'),
	)
	assert.equal(
		env.cloud.events(id).find((e) => e.eventType === 'tool_call' && e.toolCallId === 'toolu_w')?.toolName,
		'Write',
	)
})

test('the task diff goes up for a task the session made, without env files', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	await bound(env, c)
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	writeFileSync(join(env.repo, 'calc.py'), 'def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n')
	writeFileSync(join(env.repo, '.env'), 'SECRET=1\n')
	c.append(
		assistant(c.uuid(), 'msg_b', [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'echo' } }]),
	)
	c.append(toolResult(c.uuid(), 'toolu_b', ''))
	await c.event({ kind: 'rows' })
	const files = () => [...env.streams.state(orgOf(env), taskId).files.values()].map((f) => f.path)
	await waitFor('the diff', () => files().includes('calc.py'))
	assert.deepEqual(files(), ['calc.py'])
})

// ---- Steer ----

test('a web message runs as the user, once, and its prompt is not sent twice', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await following(env)

	env.cloud.continueSession(id, 'what is 6 times 7?')
	const submit = await c.action('submit')
	assert.equal(submit.text, 'what is 6 times 7?')
	await waitFor('the notice', async () => {
		await c.poll(50)
		return c.actions.some((a) => a.kind === 'toast' && a.text === 'Message from the web app')
	})
	// Claude Code runs it: the prompt as typed by the mod, its transcript line, the turn.
	const turn = await c.prompt('what is 6 times 7?', 'web')
	await c.reply(turn, '42')
	await waitFor('the answer', () => messages(env, id, 'assistant').includes('42'))
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	assert.deepEqual(messages(env, id, 'user'), ['hello', 'what is 6 times 7?'])
	assert.deepEqual(env.cloud.statuses(id).slice(-3), ['resuming', 'running', 'ready_for_input'])
})

test('a web /compact compacts, and a web /name that is a command runs it', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	await c.post('/commands', {
		sessionId: c.sessionId,
		commands: [{ name: 'review', description: 'Review', kind: 'user' }],
	})
	const id = await bound(env, c)
	await following(env)
	env.cloud.continueSession(id, '/compact')
	await c.action('compact')
	await c.turn('/compact')
	env.cloud.continueSession(id, '/review the branch')
	const command = await c.action('command')
	assert.deepEqual([command.command, command.args], ['review', 'the branch'])
	// Linking sends the report without waiting on it, so it can land after the actions.
	await waitFor('the report', () => env.cloud.requests.some((r) => r.path.endsWith('/agentCommands/report')))
	const report = env.cloud.requests.find((r) => r.path.endsWith('/agentCommands/report'))?.body as {
		agent: string
		commands: { name: string }[]
	}
	assert.equal(report.agent, 'claude-code')
	assert.deepEqual(
		report.commands.map((c) => c.name),
		['review'],
	)
})

test('the web stop aborts a running turn; while idle it reports interrupted', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await following(env)

	const turn = await c.prompt('take a while')
	await waitFor('running', () => env.cloud.statuses(id).at(-1) === 'running')
	env.cloud.interruptSession(id)
	await c.action('abort')
	await c.event({ kind: 'turn-end', turnId: turn, reason: 'aborted' })
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')

	// A web message between the stops, as the web app's own rows differ by updated_at.
	env.cloud.continueSession(id, 'quick one')
	await c.action('submit')
	await c.turn('quick one')
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	env.cloud.interruptSession(id)
	await waitFor('interrupted when idle', () => env.cloud.statuses(id).at(-1) === 'interrupted')
})

test('a web message sent while Claude Code was closed runs when the session opens again', async (t) => {
	const env = await setUp(t)
	const sessionId = crypto.randomUUID()
	const first = await env.claude({ sessionId })
	await first.hello()
	const id = await bound(env, first)
	await first.exit()
	env.cloud.continueSession(id, 'while you were away')

	const again = await env.claude({ sessionId })
	await again.hello()
	assert.equal((await again.action('submit')).text, 'while you were away')
})

test('only the process whose session it is takes a web message', async (t) => {
	const env = await setUp(t)
	const a = await env.claude()
	await a.hello()
	const id = await bound(env, a)
	const b = await env.claude()
	await b.hello()
	await following(env)
	env.cloud.continueSession(id, 'for a')
	await a.action('submit')
	await new Promise((r) => setTimeout(r, 300))
	await b.poll(0)
	assert.ok(!b.actions.some((x) => x.kind === 'submit'))
})

// ---- Collaborate ----

test('the HumanLayer tools act on the linked task, one call at a time', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	const reply = await c.hello()
	assert.deepEqual(
		reply.tools?.map((tool) => tool.name),
		[
			'get_artifact_comments',
			'update_artifact_comments',
			'reply_to_artifact_comment',
			'get_diff_comments',
			'reply_to_diff_comment',
			'update_diff_comments',
			'library_researcher',
		],
	)
	const before = await c.tool('get_artifact_comments', { artifact_filename: 'plan.md' })
	assert.match(before.text, /not linked/)
	await bound(env, c)
	env.cloud.stub('comments/get', { comments: [] })
	const after = await c.tool('get_artifact_comments', { artifact_filename: 'plan.md' })
	assert.equal(after.isError, undefined)
	const body = env.cloud.requests.find((r) => r.path.endsWith('/comments/get'))?.body as { taskId: string }
	assert.equal(body.taskId, env.cloud.sessions().at(-1)?.taskId)
})

// ---- approvals ----

test('a permission ask becomes a web approval on its tool call, and the web answer reaches Claude Code', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await following(env)
	await c.prompt('run it')
	const input = { command: 'rm -rf build' }
	const answer = c.ask({ toolUseId: 'toolu_rm', tool: 'Bash', input })
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	const approval = env.cloud.approvals(id)[0]
	assert.equal(approval?.toolUseId, 'toolu_rm')
	const events = env.cloud.events(id)
	assert.ok(
		events.some((e) => e.eventType === 'tool_call' && e.toolCallId === 'toolu_rm'),
		'the call goes up before its approval',
	)
	env.cloud.resolveApproval(approval?.id ?? '', 'deny', 'use make clean')
	assert.deepEqual(await answer, { behavior: 'deny', message: 'use make clean' })
})

test('an answer in the terminal first resolves the web approval', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await c.prompt('run it')
	const answer = c.ask({ toolUseId: 'toolu_ls', tool: 'Bash', input: { command: 'ls' } })
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	await c.event({ kind: 'tool-done', toolUseId: 'toolu_ls', tool: 'Bash', input: { command: 'ls' }, isError: false })
	assert.deepEqual(await answer, { behavior: 'none' })
	await waitFor('approved', () => env.cloud.approvals(id)[0]?.status === 'approved')

	const denied = c.ask({ toolUseId: 'toolu_rm', tool: 'Bash', input: { command: 'rm x' } })
	await waitFor('the second approval', () => env.cloud.approvals(id).length === 2)
	await c.event({
		kind: 'tool-done',
		toolUseId: 'toolu_rm',
		tool: 'Bash',
		input: { command: 'rm x' },
		isError: true,
		text: "The user doesn't want to proceed with this tool use.",
	})
	await denied
	await waitFor('denied', () => env.cloud.approvals(id)[1]?.status === 'denied')
})

test('a web stop while an approval waits denies it first, and stops the turn', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await following(env)
	await c.prompt('run it')
	const answer = c.ask({ toolUseId: 'toolu_x', tool: 'Bash', input: { command: 'make' } })
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	env.cloud.interruptSession(id)
	assert.deepEqual(await answer, { behavior: 'deny', message: 'Stopped from HumanLayer.', interrupt: true })
	await waitFor('denied', () => env.cloud.approvals(id)[0]?.status === 'denied')
})

// ---- Trust ----

test('a turn cut short by a crash ends interrupted at the next start, its approvals denied', async (t) => {
	const env = await setUp(t)
	const sessionId = crypto.randomUUID()
	const first = await env.claude({ sessionId })
	await first.hello()
	const id = await bound(env, first)
	await first.prompt('run it')
	void first.ask({ toolUseId: 'toolu_c', tool: 'Bash', input: { command: 'make' } }).catch(() => undefined)
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	await waitFor('the approval noted', () => {
		const bindings = join(env.home, 'claude-code', 'bindings', 'local', `${sessionId}.json`)
		return (JSON.parse(readFileSync(bindings, 'utf8')).running?.approvalIds ?? []).length === 1
	})
	await first.exit('SIGKILL')

	// Another session in the same folder, in a new process: the lost turn ends without anyone resuming it.
	const next = await env.claude()
	await next.hello()
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')
	await waitFor('denied', () => env.cloud.approvals(id)[0]?.status === 'denied')
})

test('a clean exit ends a running turn as interrupted and sends what is queued', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await c.prompt('long one')
	c.append(assistant(c.uuid(), 'msg_last', [{ type: 'text', text: 'last words' }]))
	await c.exit('SIGINT')
	assert.ok(messages(env, id, 'assistant').includes('last words'))
	assert.equal(env.cloud.statuses(id).at(-1), 'interrupted')
})

test('a resumed session sends what the cloud never took, and nothing twice', async (t) => {
	const env = await setUp(t)
	const sessionId = crypto.randomUUID()
	const first = await env.claude({ sessionId })
	await first.hello()
	const id = await bound(env, first)
	await first.exit()
	// Lines written while no server ran (another tool wrote them, or the flush ran out of time).
	first.append(assistant(first.uuid(), 'msg_gap', [{ type: 'text', text: 'from the gap' }]))
	const again = await env.claude({ sessionId })
	await again.hello()
	await waitFor('the gap', () => messages(env, id, 'assistant').includes('from the gap'))
	assert.equal(env.cloud.sessions().length, 1)
	await again.turn('next', 'after resume')
	await waitFor('after resume', () => messages(env, id, 'assistant').includes('after resume'))
	assert.deepEqual(messages(env, id, 'assistant'), ['ok', 'from the gap', 'after resume'])
})

// ---- /humanlayer ----

test('attach before the first prompt survives a restart, and attach new makes a fresh task each time', async (t) => {
	const env = await setUp(t)
	const task = env.cloud.seedTask({ slug: 'existing-task' })
	const first = await env.claude()
	await first.hello()
	assert.match(
		await first.command('attach existing-task'),
		/next prompt starts a HumanLayer session in task existing-task/,
	)
	await first.exit()

	const c = await env.claude()
	await c.hello()
	assert.match(await c.command('status'), /Next prompt joins: existing-task/)
	await bound(env, c)
	assert.equal(env.cloud.sessions().at(-1)?.taskId, task.id)

	await c.command('attach new')
	await c.turn('one')
	await waitFor('a second task', () => env.cloud.tasks().length === 2)
	await c.command('attach new')
	await c.turn('two')
	await waitFor('a third task', () => env.cloud.tasks().length === 3)
})

test('off stops sending and leaves the session ready; on starts again', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	assert.equal(await c.command('off'), 'Mirroring is off for this session.')
	await c.turn('private', 'not sent')
	await new Promise((r) => setTimeout(r, 400))
	assert.ok(!messages(env, id, 'assistant').includes('not sent'))
	assert.equal(env.cloud.statuses(id).at(-1), 'ready_for_input')
	await c.command('on')
	await c.turn('public', 'sent')
	await waitFor('sent', () => messages(env, id, 'assistant').includes('sent'))
	assert.ok(!messages(env, id, 'user').includes('private'))
})

test('an ask that names no call id goes on the open call of that tool', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await c.prompt('edit it')
	const input = { file_path: `${env.repo}/calc.py`, old_string: 'a + b', new_string: 'a * b' }
	c.append(assistant(c.uuid(), 'msg_e', [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input }]))
	const answer = c.ask({ tool: 'Edit', input })
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	assert.equal(env.cloud.approvals(id)[0]?.toolUseId, 'toolu_edit')
	assert.equal(env.cloud.events(id).filter((e) => e.eventType === 'tool_call').length, 1)
	env.cloud.resolveApproval(env.cloud.approvals(id)[0]?.id ?? '', 'approve')
	assert.deepEqual(await answer, { behavior: 'allow' })
})

test('an ask answered in the terminal before its call reached the transcript still resolves on the web', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	await c.prompt('edit it')
	const input = { file_path: `${env.repo}/calc.py`, old_string: 'a + b', new_string: 'a * b', replace_all: false }
	const answer = c.ask({ tool: 'Edit', input })
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	// The terminal's yes: the call finishes under its real id, with its keys in another order.
	const { replace_all, ...rest } = input
	await c.event({
		kind: 'tool-done',
		toolUseId: 'toolu_real',
		tool: 'Edit',
		input: { replace_all, ...rest },
		isError: false,
	})
	assert.deepEqual(await answer, { behavior: 'none' })
	await waitFor('approved', () => env.cloud.approvals(id)[0]?.status === 'approved')
})
