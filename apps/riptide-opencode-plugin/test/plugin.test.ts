// The server half end to end: the real plugin setup in a fake opencode, against the pi extension's
// mock cloud and diff streams. Binding, the event mirror, the task folder hint, the task diff, web
// replies and stops, skills, the tools, and the RPC the TUI calls.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import type { StatusOutput } from '../src/rpc.ts'
import { type Env, FakeOpencode, setUp, waitFor } from './helpers/opencode.ts'

const SID = 'ses_0123456789abcdefghijKLMN'

function userMessages(env: Env, id: string): string[] {
	return env.cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === 'user')
		.map((e) => String(e.content))
}

function assistantMessages(env: Env, id: string): string[] {
	return env.cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === 'assistant')
		.map((e) => String(e.content))
}

/** Types a first prompt and waits for the bind and the turn's end. Returns the cloud session id. */
async function bound(env: Env, sessionID = SID, text = 'hello'): Promise<string> {
	const before = env.cloud.sessions().length
	await env.opencode.type(sessionID, text)
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

test('the first prompt binds a new opencode task, and the turn mirrors', async (t) => {
	const env = await setUp(t)
	env.opencode.replies.push('hi from opencode')
	const id = await bound(env)

	const session = env.cloud.sessions().at(-1)
	assert.equal(session?.codingAgent, 'opencode')
	assert.equal(session?.prompt, 'hello')
	assert.equal(session?.workingDirectory, env.repo)
	assert.match(env.cloud.tasks().at(-1)?.slug ?? '', /^opencode-[a-z0-9]{12}$/)
	await waitFor('the reply', () => assistantMessages(env, id).includes('hi from opencode'))
	// prepare wrote the first prompt itself
	assert.deepEqual(userMessages(env, id), ['hello'])
	// the mock's own ready_for_launch, then this plugin's
	assert.deepEqual(env.cloud.statuses(id).slice(-2), ['running', 'ready_for_input'])
	assert.equal(env.cloud.repositories(id).length, 1)
})

test('later prompts mirror, and every model request names the task folder', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await env.opencode.type(SID, 'second prompt')
	await waitFor('the second prompt', () => userMessages(env, id).includes('second prompt'))

	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	const [hint] = await env.opencode.systemFor(SID)
	assert.match(hint ?? '', /<artifacts_directory_information>/)
	assert.ok(hint?.includes(`.humanlayer/tasks/${slug}`))
})

test('files written to the task folder sync to the task', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	const folder = join(env.repo, '.humanlayer', 'tasks', slug)
	await waitFor('the task folder link', () => existsSync(folder))

	writeFileSync(join(folder, 'plan.md'), '# Plan\n')
	env.opencode.emit('session.tool.input.started', { sessionID: SID, id: 'call_1', name: 'write' })
	env.opencode.emit('session.tool.called', {
		sessionID: SID,
		id: 'call_1',
		input: { filePath: join(folder, 'plan.md') },
	})
	env.opencode.emit('session.tool.success', { sessionID: SID, id: 'call_1', content: [{ type: 'text', text: 'ok' }] })

	await waitFor('plan.md', () => env.cloud.artifacts(taskId).some((a) => a.fileName === 'plan.md'))
	const call = env.cloud.events(id).find((e) => e.eventType === 'tool_call')
	assert.equal(call?.toolName, 'write')
	assert.equal((call?.toolInputJson as { file_path?: string }).file_path, join(folder, 'plan.md'))
})

test('the task diff goes up for a task the session made, without env files', async (t) => {
	const env = await setUp(t)
	await bound(env)
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	writeFileSync(join(env.repo, 'calc.py'), 'def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n')
	writeFileSync(join(env.repo, '.env'), 'SECRET=1\n')
	env.opencode.emit('session.shell.ended', {
		sessionID: SID,
		shell: { id: 'sh_1', command: 'echo', exit: 0, status: 'exited' },
		output: { output: '' },
	})

	const files = () => [...env.streams.state(orgOf(env), taskId).files.values()].map((f) => f.path)
	await waitFor('the diff', () => files().includes('calc.py'))
	assert.deepEqual(files(), ['calc.py'])
})

test('a web reply runs in opencode once, and its user message is not sent twice', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)
	env.opencode.replies.push('42')

	env.cloud.continueSession(id, 'what is 6 times 7?')
	await waitFor('the answer', () => assistantMessages(env, id).includes('42'))
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')

	assert.equal(env.opencode.prompts.length, 1)
	assert.equal(env.opencode.prompts[0]?.text, 'what is 6 times 7?')
	assert.equal(env.opencode.prompts[0]?.delivery, 'queue')
	assert.deepEqual(userMessages(env, id), ['hello', 'what is 6 times 7?'])
	assert.deepEqual(env.cloud.statuses(id).slice(-3), ['resuming', 'running', 'ready_for_input'])
})

test('a web message naming a skill runs the skill, a command runs the command, and /compact asks the TUI', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)

	env.cloud.continueSession(id, '/show-me calc.py')
	await waitFor('the skill prompt', () => env.opencode.prompts.length === 1)
	assert.deepEqual(env.opencode.prompts[0]?.skills, [{ id: 'show-me' }])
	assert.equal(env.opencode.prompts[0]?.text, 'calc.py')
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')

	env.cloud.continueSession(id, '/review the branch')
	await waitFor('the command', () => env.opencode.commands.length === 1)
	assert.deepEqual(env.opencode.commands[0], {
		sessionID: SID,
		name: 'review',
		text: 'the branch',
		delivery: 'queue',
	})
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	// neither the command's template nor the skill's prompt went up as a second user message
	assert.deepEqual(userMessages(env, id), ['hello', '/show-me calc.py', '/review the branch'])

	env.cloud.continueSession(id, '/compact')
	await waitFor('the compact event', () => env.opencode.rpcEvents.some((e) => e.name === 'compact'))
})

test('the web stop button interrupts a running turn, and marks an idle one interrupted', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)

	env.opencode.holdNextTurn = true
	env.cloud.continueSession(id, 'take a while')
	await waitFor('running', () => env.cloud.statuses(id).at(-1) === 'running')
	env.cloud.interruptSession(id)
	await waitFor('the interrupt', () => env.opencode.interrupts.includes(SID))
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')

	env.cloud.continueSession(id, 'quick one')
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	env.cloud.interruptSession(id)
	await waitFor('interrupted when idle', () => env.cloud.statuses(id).at(-1) === 'interrupted')
	assert.deepEqual(env.opencode.interrupts, [SID])
})

test('a web message sent while opencode was closed runs once when it opens, and older ones never replay', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)
	env.cloud.continueSession(id, 'an old message')
	await waitFor('ready_for_input', () => env.opencode.prompts.length === 1)
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	await env.opencode.unload()

	env.cloud.continueSession(id, 'sent while closed')
	const reopened = new FakeOpencode(env.repo)
	t.after(() => reopened.unload())
	await reopened.load()

	await waitFor('the waiting message', () => reopened.prompts.length > 0)
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	assert.deepEqual(
		reopened.prompts.map((p) => p.text),
		['sent while closed'],
	)
})

test('two opencode processes in one folder run a web message once between them', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)
	const before = env.cloud.requests.length
	const second = new FakeOpencode(env.repo)
	t.after(() => second.unload())
	await second.load()
	// the second process's first read, then its live request: both now wait on the same change
	await waitFor('the second follower', () => {
		const later = env.cloud.requests.slice(before).filter((r) => r.plane === 'sync')
		const first = later.findIndex((r) => (r.body as { offset?: string }).offset === '-1')
		return first >= 0 && later.slice(first).some((r) => (r.body as { live?: string }).live === 'true')
	})

	env.cloud.continueSession(id, 'only once')
	await waitFor('the message', () => env.opencode.prompts.length + second.prompts.length > 0)
	await new Promise((resolve) => setTimeout(resolve, 300))
	assert.equal(env.opencode.prompts.length + second.prompts.length, 1)
})

test('subagent sessions are not mirrored on their own', async (t) => {
	const env = await setUp(t)
	await bound(env)
	env.opencode.parents.set('ses_child', SID)
	await env.opencode.type('ses_child', 'subagent work')
	await new Promise((resolve) => setTimeout(resolve, 200))
	assert.equal(env.cloud.sessions().length, 1)
	const status = await env.opencode.call<StatusOutput>('status', { sessionID: 'ses_child' })
	assert.equal(status.session?.state, 'off')
})

test("a subagent's work and approvals mirror into its parent, under the tool call that ran it", async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	const child = 'ses_child'
	env.opencode.parents.set(child, SID)
	const task = 'toolu_task'
	env.opencode.emit('session.tool.input.started', { sessionID: SID, id: task, name: 'subagent' })
	const input = { agent: 'general', description: 'Count lines', prompt: 'count them' }
	env.opencode.emit('session.tool.called', { sessionID: SID, id: task, input, executed: false })
	// The subagent starts before opencode names its session in the tool call's progress.
	env.opencode.emit('session.execution.started', { sessionID: child })
	env.opencode.emit('session.text.ended', {
		sessionID: child,
		assistantMessageID: 'msg_c',
		ordinal: 0,
		text: 'on it',
	})
	env.opencode.emit('session.tool.progress', { sessionID: SID, id: task, metadata: { sessionID: child } })
	const { callID, requestID } = env.opencode.askShell(child, 'wc -l a.py')

	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	assert.equal(env.cloud.approvals(id)[0]?.toolUseId, callID)
	env.cloud.resolveApproval(env.cloud.approvals(id)[0]?.id ?? '', 'approve')
	await waitFor('the reply', () => env.opencode.permissionReplies.length === 1)
	assert.equal(env.opencode.permissionReplies[0]?.sessionID, child, 'the subagent asked, so it hears the answer')
	assert.equal(env.opencode.permissionReplies[0]?.requestID, requestID)

	env.opencode.emit('session.execution.succeeded', { sessionID: child })
	const content = [{ type: 'text', text: `<subagent sessionID="${child}" state="completed">\n12 a.py\n</subagent>` }]
	env.opencode.emit('session.tool.success', { sessionID: SID, id: task, content, metadata: { sessionID: child } })
	await waitFor('the result', () => env.cloud.events(id).some((e) => e.toolResultForId === task))

	const events = env.cloud.events(id)
	const call = events.find((e) => e.toolCallId === task)
	assert.equal(call?.toolName, 'Task')
	assert.deepEqual(call?.toolInputJson, {
		subagent_type: 'general',
		description: 'Count lines',
		prompt: 'count them',
	})
	assert.equal(events.find((e) => e.toolResultForId === task)?.toolResultContent, '12 a.py')
	assert.equal(events.find((e) => e.content === 'on it')?.parentToolUseId, task)
	assert.equal(events.find((e) => e.toolCallId === callID)?.parentToolUseId, task)
	assert.equal(env.cloud.sessions().length, 1)
	assert.equal(env.cloud.statuses(id).at(-1), 'running', "the subagent's run is not the session's")
})

test('the web stop rejects open permission requests before it interrupts', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await following(env)
	env.opencode.holdNextTurn = true
	void env.opencode.type(SID, 'do something risky')
	const { requestID } = env.opencode.askShell(SID, 'rm -rf /tmp/x')
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)

	env.cloud.interruptSession(id)
	await waitFor('the interrupt', () => env.opencode.interrupts.includes(SID))
	assert.deepEqual(env.opencode.permissionReplies, [{ sessionID: SID, requestID, decision: 'reject' }])
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')
})

test('status, off, on and attach', async (t) => {
	const env = await setUp(t)
	const unbound = await env.opencode.call<StatusOutput>('status', { sessionID: SID })
	assert.equal(unbound.signedIn?.source, 'pat')
	assert.equal(unbound.session?.state, 'unbound')

	const id = await bound(env)
	const linked = await env.opencode.call<StatusOutput>('status', { sessionID: SID })
	assert.equal(linked.session?.state, 'mirroring')
	assert.equal(linked.session?.url, `http://app.test/sessions/${id}`)

	await env.opencode.call('off', { sessionID: SID })
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	const events = env.cloud.events(id).length
	await env.opencode.type(SID, 'off the record')
	await new Promise((resolve) => setTimeout(resolve, 200))
	assert.equal(env.cloud.events(id).length, events)
	assert.deepEqual(await env.opencode.systemFor(SID), [])

	await env.opencode.call('on', { sessionID: SID })
	await env.opencode.type(SID, 'back on')
	await waitFor('back on', () => userMessages(env, id).includes('back on'))
	assert.ok(!userMessages(env, id).includes('off the record'))

	const reply = await env.opencode.call<{ message: string }>('attach', { sessionID: SID, target: 'new' })
	assert.match(reply.message, /next prompt/)
	const attached = await env.opencode.call<StatusOutput>('status', { sessionID: SID })
	assert.equal(attached.session?.attach, 'new')
	const second = await bound(env, SID, 'in a new task')
	assert.notEqual(second, id)
	assert.equal(env.cloud.tasks().length, 2)
	assert.equal(env.cloud.statuses(id).at(-1), 'ready_for_input')
})

test('an attach with no session open takes the next new session to the task', async (t) => {
	const env = await setUp(t)
	const task = env.cloud.seedTask({ slug: 'eng-7-picked' })
	const reply = await env.opencode.call<{ message: string }>('attach', { target: 'eng-7-picked' })
	assert.match(reply.message, /next new session/)
	const home = await env.opencode.call<StatusOutput>('status', {})
	assert.equal(home.session?.attach, 'eng-7-picked')

	await bound(env)
	assert.equal(env.cloud.sessions()[0]?.taskId, task.id)
	const after = await env.opencode.call<StatusOutput>('status', {})
	assert.equal(after.session, undefined, 'only the next session joins it')
})

test('a session joins the worktree task its folder links to', async (t) => {
	const env = await setUp(t)
	const task = env.cloud.seedTask({ slug: 'eng-1-worktree' })
	const store = join(env.home, 'artifacts', task.id)
	mkdirSync(store, { recursive: true })
	mkdirSync(join(env.repo, '.humanlayer', 'tasks'), { recursive: true })
	symlinkSync(store, join(env.repo, '.humanlayer', 'tasks', 'eng-1-worktree'))

	await bound(env)
	assert.equal(env.cloud.sessions().at(-1)?.taskId, task.id)
	assert.equal(env.cloud.tasks().length, 1)
})

test('the HumanLayer tools run outside code mode, on the bound task', async (t) => {
	const env = await setUp(t)
	await bound(env)
	const taskId = env.cloud.sessions().at(-1)?.taskId
	env.cloud.stub('comments/get', { comments: [] })
	const tool = env.opencode.tools.get('get_artifact_comments')
	assert.equal(tool?.options?.codemode, false)
	const out = await tool?.execute(
		{ artifact_filename: 'plan.md' },
		{ sessionID: SID, signal: AbortSignal.timeout(5000) },
	)
	assert.ok(out?.content)
	const call = env.cloud.requests.find((r) => r.path.endsWith('comments/get'))
	assert.equal((call?.body as { taskId?: string }).taskId, taskId)

	// a throw is how opencode shows the model a failed tool call
	await assert.rejects(
		tool?.execute(
			{ artifact_filename: 'plan.md' },
			{ sessionID: 'ses_other', signal: AbortSignal.timeout(5000) },
		) ?? Promise.resolve(),
		/not linked/,
	)
})

test('skills: the bundled ones load, and the report tells the web composer', async (t) => {
	const env = await setUp(t)
	assert.ok(env.opencode.skills.some((s) => s.id === 'create-research'))
	await waitFor('the report', () => env.cloud.requests.some((r) => r.path.endsWith('agentCommands/report')))
	const report = env.cloud.requests.find((r) => r.path.endsWith('agentCommands/report'))?.body as {
		agent: string
		workspacePath: string
		skills: { name: string; scope?: string }[]
		commands: { name: string }[]
	}
	assert.equal(report.agent, 'opencode')
	assert.equal(report.workspacePath, env.repo)
	assert.equal(report.skills.find((s) => s.name === 'create-research')?.scope, 'plugin')
	assert.deepEqual(
		report.commands.map((c) => c.name),
		['review'],
	)
})

test('the plugin reads HUMANLAYER_PAT and removes it from the environment', async (t) => {
	const env = await setUp(t)
	assert.equal(process.env.HUMANLAYER_PAT, undefined)
	await bound(env)
})

test('signed out, a prompt does not bind and the TUI hears why, once', async (t) => {
	const env = await setUp(t, { pat: false })
	await env.opencode.type(SID, 'hello')
	await env.opencode.type(SID, 'again')
	await new Promise((resolve) => setTimeout(resolve, 200))
	assert.equal(env.cloud.sessions().length, 0)
	const notices = env.opencode.rpcEvents.filter((e) => e.name === 'notice')
	assert.equal(notices.length, 1)
	assert.match(String(notices[0]?.data.message), /login/)
	const status = await env.opencode.call<StatusOutput>('status', { sessionID: SID })
	assert.equal(status.signedIn, undefined)
})

test('a session opencode continues keeps its cloud session', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	await env.opencode.unload()
	const saved = JSON.parse(readFileSync(join(env.home, 'opencode', 'bindings', 'local', `${SID}.json`), 'utf8')) as {
		cloudSessionId: string
	}
	assert.equal(saved.cloudSessionId, id)

	const reopened = new FakeOpencode(env.repo)
	t.after(() => reopened.unload())
	await reopened.load()
	await reopened.type(SID, 'continued')
	await waitFor('the continued prompt', () => userMessages(env, id).includes('continued'))
	assert.equal(env.cloud.sessions().length, 1)
})

test('a run opencode never finished, because it crashed, ends interrupted when opencode starts again', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	env.opencode.holdNextTurn = true
	void env.opencode.type(SID, 'do something risky')
	env.opencode.askShell(SID, 'rm -rf /tmp/x')
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	const file = join(env.home, 'opencode', 'bindings', 'local', `${SID}.json`)
	const approvalId = env.cloud.approvals(id)[0]?.id
	await waitFor('the run noted', () => readFileSync(file, 'utf8').includes(`"${approvalId}"`))

	// The first process never exits cleanly; a second one starts, and nobody opens the session.
	const reopened = new FakeOpencode(env.repo)
	t.after(() => reopened.unload())
	await reopened.load()
	await waitFor('the approval denied', () => env.cloud.approvals(id)[0]?.status === 'denied')
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')
	await waitFor('the run cleared', () => !readFileSync(file, 'utf8').includes('"running"'))
})

/** The internal org id the diff streams are keyed by: the mock's only org. */
function orgOf(env: Env): string {
	return env.cloud.state.orgs[0]?.internalOrgId ?? ''
}

test('a permission request becomes a web approval on its tool call, and a web answer reaches opencode', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	const { callID, requestID } = env.opencode.askShell(SID, 'rm -rf build')

	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	const approval = env.cloud.approvals(id)[0]
	assert.equal(approval?.toolName, 'bash')
	assert.deepEqual(approval?.toolInput, { command: 'rm -rf build' })
	assert.equal(approval?.toolUseId, callID)
	assert.equal(env.cloud.statuses(id).at(-1), 'needs_approval')
	const call = env.cloud.events(id).find((e) => e.eventType === 'tool_call')
	assert.equal(call?.toolCallId, callID, 'the tool call went up first, so the card has its call')

	env.cloud.resolveApproval(approval?.id ?? '', 'approve')
	await waitFor('the reply', () => env.opencode.permissionReplies.length === 1)
	assert.deepEqual(env.opencode.permissionReplies[0], { sessionID: SID, requestID, decision: 'once' })
	assert.equal(env.cloud.statuses(id).at(-1), 'running')
	// the reply's own permission.replied does not answer the approval a second time
	await new Promise((resolve) => setTimeout(resolve, 200))
	assert.ok(!env.cloud.requests.some((r) => r.path.endsWith('approvals/resolve')))
})

test('a web denial reaches opencode as a reject, with its comment', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	const { requestID } = env.opencode.askShell(SID, 'git push --force')
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)

	env.cloud.resolveApproval(env.cloud.approvals(id)[0]?.id ?? '', 'deny', 'not on main')
	await waitFor('the reply', () => env.opencode.permissionReplies.length === 1)
	assert.deepEqual(env.opencode.permissionReplies[0], {
		sessionID: SID,
		requestID,
		decision: 'reject',
		message: 'not on main',
	})
})

test('an answer in opencode answers the web approval too', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	const { requestID } = env.opencode.askShell(SID, 'make test')
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)

	env.opencode.emit('permission.replied', { sessionID: SID, requestID, reply: 'always' })
	await waitFor('approved', () => env.cloud.approvals(id)[0]?.status === 'approved')
	assert.equal(env.cloud.statuses(id).at(-1), 'running')
	assert.equal(env.opencode.permissionReplies.length, 0)

	const second = env.opencode.askShell(SID, 'make deploy')
	await waitFor('the second approval', () => env.cloud.approvals(id).length === 2)
	env.opencode.emit('permission.replied', { sessionID: SID, requestID: second.requestID, reply: 'reject' })
	await waitFor('denied', () => env.cloud.approvals(id)[1]?.status === 'denied')
})

test('an answer in opencode before the approval reached the cloud still answers it', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	env.cloud.fail({ route: 'approvals/create', status: 503 })
	const { requestID } = env.opencode.askShell(SID, 'ls')
	env.opencode.emit('permission.replied', { sessionID: SID, requestID, reply: 'once' })

	await waitFor('approved', () => env.cloud.approvals(id)[0]?.status === 'approved')
	assert.equal(env.cloud.statuses(id).at(-1), 'running')
})

test("opencode's session title names the HumanLayer session, and the task it made", async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	env.opencode.emit('session.renamed', { sessionID: SID, title: 'Add a multiply function' })
	await waitFor('the task name', () => env.cloud.tasks().at(-1)?.name === 'Add a multiply function')
	assert.equal(env.cloud.sessions().find((s) => s.id === id)?.sessionName, 'Add a multiply function')
})

test('a joined task keeps its name when opencode renames the session', async (t) => {
	const env = await setUp(t, { env: { HUMANLAYER_TASK: 'eng-2-joined' } })
	env.cloud.seedTask({ slug: 'eng-2-joined', name: 'ENG-2 the real name' })
	const id = await bound(env)
	env.opencode.emit('session.renamed', { sessionID: SID, title: 'opencode title' })
	await waitFor(
		'the session title',
		() => env.cloud.sessions().find((s) => s.id === id)?.sessionName === 'opencode title',
	)
	assert.equal(env.cloud.tasks()[0]?.name, 'ENG-2 the real name')
})

test('an approval nobody answered is denied when opencode exits, and the session ends interrupted', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	env.opencode.holdNextTurn = true
	void env.opencode.type(SID, 'do something risky')
	env.opencode.askShell(SID, 'rm -rf /tmp/x')
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)

	await env.opencode.unload()
	assert.equal(env.cloud.approvals(id)[0]?.status, 'denied')
	assert.equal(env.cloud.statuses(id).at(-1), 'interrupted')
})

test('an approval still retrying creation is denied before shutdown finishes', async (t) => {
	const env = await setUp(t)
	const id = await bound(env)
	env.opencode.holdNextTurn = true
	void env.opencode.type(SID, 'do something risky')
	env.cloud.fail({ route: 'approvals/create', status: 503 })
	env.cloud.fail({ route: 'approvals/resolve', status: 503 })
	env.opencode.askShell(SID, 'rm -rf /tmp/x')
	await waitFor('the first approval request', () =>
		env.cloud.requests.some((r) => r.path.endsWith('approvals/create')),
	)
	assert.equal(env.cloud.approvals(id).length, 0)

	await env.opencode.unload()
	assert.equal(env.cloud.approvals(id).length, 1)
	assert.equal(env.cloud.approvals(id)[0]?.status, 'denied')
	assert.equal(env.cloud.statuses(id).at(-1), 'interrupted')
})
