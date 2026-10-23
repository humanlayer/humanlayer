// Watch: sign-in by PAT, the host, the link at the first prompt, the transcript, the status and the
// footer. The real server, driven by a fake mod over its socket, against the mock cloud.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { assistant, type Env, type FakeClaude, setUp, toolResult, waitFor } from './helpers/claude.ts'

function messages(env: Env, id: string, role: 'user' | 'assistant'): string[] {
	return env.cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === role)
		.map((e) => String(e.content))
}

/** A first prompt and its reply. Returns the cloud session id. */
async function bound(env: Env, c: FakeClaude, text = 'hello'): Promise<string> {
	const before = env.cloud.sessions().length
	await c.turn(text, 'hi from claude')
	await waitFor('the bind', () => env.cloud.sessions().length > before)
	const id = env.cloud.sessions().at(-1)?.id ?? ''
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	return id
}

test('the first prompt links a new claude-code task, and the turn mirrors', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)

	const session = env.cloud.sessions().at(-1)
	assert.equal(session?.codingAgent, 'claude-code')
	assert.equal(session?.prompt, 'hello')
	assert.equal(session?.model, 'claude-sonnet-5-5')
	assert.equal(session?.workingDirectory, env.repo)
	assert.match(env.cloud.tasks().at(-1)?.slug ?? '', /^claude-[a-z0-9]{12}$/)
	await waitFor('the reply', () => messages(env, id, 'assistant').includes('hi from claude'))
	// prepare wrote the first prompt itself, and its transcript line is not sent again
	assert.deepEqual(messages(env, id, 'user'), ['hello'])
	assert.deepEqual(env.cloud.statuses(id).slice(-2), ['running', 'ready_for_input'])
	assert.equal(env.cloud.repositories(id).length, 1)
	assert.match((await c.action('toast')).text, /^Mirroring to http:\/\/app\.test\/sessions\//)
})

test('the host beats as a mirror-only Claude Code host', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	await waitFor('a heartbeat', () => env.cloud.requests.some((r) => r.path.endsWith('/hosts/heartbeat')))
	const beat = env.cloud.requests.find((r) => r.path.endsWith('/hosts/heartbeat'))?.body as { capabilities: string[] }
	assert.deepEqual(beat.capabilities, ['attachedSessionsOnly', 'agent:claude-code'])
})

test('later prompts, tool calls, results and usage mirror as the daemon sends them', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)

	const turn = await c.prompt('read calc.py')
	const msg = 'msg_tools'
	c.append(assistant(c.uuid(), msg, [{ type: 'thinking', thinking: '', signature: 'x' }]))
	c.append(
		assistant(c.uuid(), msg, [
			{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: `${env.repo}/calc.py` } },
		]),
	)
	c.append(toolResult(c.uuid(), 'toolu_1', 'def add(a, b):'))
	// A result whose call never reached the transcript: the call still goes up first.
	c.append(toolResult(c.uuid(), 'toolu_lost', 'Interrupted'))
	c.append(assistant(c.uuid(), 'msg_zero', [{ type: 'text', text: 'done' }], { input_tokens: 0, output_tokens: 0 }))
	await c.reply(turn, 'all read')

	await waitFor('the second prompt', () => messages(env, id, 'user').includes('read calc.py'))
	await waitFor('the reply', () => messages(env, id, 'assistant').includes('all read'))
	const events = env.cloud.events(id)
	const call = events.find((e) => e.eventType === 'tool_call' && e.toolCallId === 'toolu_1')
	assert.equal(call?.toolName, 'Read')
	assert.deepEqual(call?.toolInputJson, { file_path: `${env.repo}/calc.py` })
	assert.equal(
		events.find((e) => e.eventType === 'tool_result' && e.toolResultForId === 'toolu_1')?.toolResultContent,
		'def add(a, b):',
	)
	const lost = events.findIndex((e) => e.eventType === 'tool_call' && e.toolCallId === 'toolu_lost')
	const lostResult = events.findIndex((e) => e.eventType === 'tool_result' && e.toolResultForId === 'toolu_lost')
	assert.ok(lost >= 0 && lost < lostResult, 'the call goes up before its result')
	// empty thinking (Claude Code keeps only its signature) sends nothing
	assert.equal(events.filter((e) => e.eventType === 'thinking').length, 0)

	const usage = env.cloud.requests
		.filter((r) => r.path.endsWith('/sessions/update'))
		.map((r) => r.body as { usageReportKey?: string })
		.filter((b) => b.usageReportKey)
		.map((b) => b.usageReportKey)
	// once per API message, never the all-zero one
	assert.equal(usage.filter((k) => k === msg).length, 1)
	assert.ok(!usage.includes('msg_zero'))
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
})

test('the footer shows the link state', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	assert.equal((await c.action('status')).text, 'HumanLayer: ready')
	await bound(env, c)
	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	await waitFor('the linked footer', async () => {
		await c.poll(100)
		return c.actions.some((a) => a.kind === 'status' && a.text === `HumanLayer: ${slug}`)
	})
})

test('in a session the HumanLayer daemon runs, the plugin does nothing', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	const reply = await c.hello({ HUMANLAYER_SESSION_ID: 'daemon-session' })
	assert.match(reply.disabled ?? '', /daemon/)
	assert.equal(reply.tools, undefined)
	await c.turn('hello')
	await new Promise((r) => setTimeout(r, 500))
	assert.equal(env.cloud.sessions().length, 0)
	assert.ok(!env.cloud.requests.some((r) => r.path.endsWith('/hosts/heartbeat')))
	assert.match(await c.command('status'), /Turned off: the HumanLayer daemon/)
})

test('HUMANLAYER_CLAUDE_DISABLE=1 mirrors nothing, and status still works', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	const reply = await c.hello({ HUMANLAYER_CLAUDE_DISABLE: '1' })
	assert.equal(reply.disabled, undefined)
	assert.deepEqual(reply.tools, [])
	await c.turn('hello')
	await new Promise((r) => setTimeout(r, 500))
	assert.equal(env.cloud.sessions().length, 0)
	assert.ok(!env.cloud.requests.some((r) => r.path.endsWith('/hosts/heartbeat')))
	const status = await c.command('status')
	assert.match(status, /Turned off by HUMANLAYER_CLAUDE_DISABLE/)
	assert.match(status, /Signed in with HUMANLAYER_PAT/)
	assert.match(await c.command('on'), /HUMANLAYER_CLAUDE_DISABLE/)
})

test('/humanlayer session and open-session give the link once the session is linked', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	assert.match(await c.command('open-session'), /not linked yet/)
	const id = await bound(env, c)
	const url = `http://app.test/sessions/${id}`
	assert.equal(await c.command('session'), url)
	assert.equal(await c.command('open-session'), `Opened ${url}`)
})

test('signed out, the first prompt does not link and says how to sign in', async (t) => {
	const env = await setUp(t, { pat: false })
	const c = await env.claude()
	await c.hello()
	await c.turn('hello')
	assert.match((await c.action('toast')).text, /Not signed in to HumanLayer\. Run \/humanlayer login\./)
	assert.equal(env.cloud.sessions().length, 0)
	assert.match(await c.command('status'), /Not signed in/)
})

test('a compaction shows as a boundary, then its summary', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	const boundary = c.uuid()
	c.append({
		type: 'system',
		subtype: 'compact_boundary',
		uuid: boundary,
		compactMetadata: { trigger: 'manual', preTokens: 9000, postTokens: 1200 },
	})
	c.append({
		type: 'user',
		uuid: c.uuid(),
		isCompactSummary: true,
		message: { role: 'user', content: 'The summary.' },
	})
	await c.event({ kind: 'rows' })
	await waitFor('the summary', () =>
		env.cloud.events(id).some((e) => String(e.content).includes('context_compaction_summary')),
	)
	const [first, second] = env.cloud
		.events(id)
		.filter((e) => e.eventType === 'system')
		.map((e) => JSON.parse(String(e.content)))
	assert.equal(first.kind, 'context_compaction')
	assert.equal(first.trigger, 'manual')
	assert.equal(second.kind, 'context_compaction_summary')
	assert.equal(second.summary, 'The summary.')
})

test("the user's own ! shell command shows as a Bash call with its output", async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	c.append({ type: 'user', uuid: c.uuid(), message: { role: 'user', content: '<bash-input>ls</bash-input>' } })
	c.append({
		type: 'user',
		uuid: c.uuid(),
		message: { role: 'user', content: '<bash-stdout>calc.py</bash-stdout><bash-stderr></bash-stderr>' },
	})
	await c.event({ kind: 'rows' })
	await waitFor('the shell result', () =>
		env.cloud.events(id).some((e) => e.eventType === 'tool_result' && e.toolResultContent === 'calc.py'),
	)
	const call = env.cloud.events(id).find((e) => e.eventType === 'tool_call' && e.toolName === 'Bash')
	assert.deepEqual(call?.toolInputJson, { command: 'ls' })
})

test("a subagent's messages and tools nest under its Agent call", async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	const turn = await c.prompt('research it')
	c.append(
		assistant(c.uuid(), 'msg_a', [
			{
				type: 'tool_use',
				id: 'toolu_agent',
				name: 'Agent',
				input: { subagent_type: 'general-purpose', prompt: 'look', description: 'Look' },
			},
		]),
	)
	const file = c.subagent('a1', 'toolu_agent')
	c.append({ type: 'user', uuid: c.uuid(), isSidechain: true, message: { role: 'user', content: 'look' } }, file)
	c.append(
		{
			...assistant(c.uuid(), 'msg_sub', [
				{ type: 'tool_use', id: 'toolu_sub', name: 'Grep', input: { pattern: 'add' } },
			]),
			isSidechain: true,
		},
		file,
	)
	c.append({ ...toolResult(c.uuid(), 'toolu_sub', 'calc.py'), isSidechain: true }, file)
	c.append({ ...assistant(c.uuid(), 'msg_sub2', [{ type: 'text', text: 'found it' }]), isSidechain: true }, file)
	c.append(toolResult(c.uuid(), 'toolu_agent', 'found it'))
	await c.reply(turn, 'done')
	await waitFor('the subagent reply', () => messages(env, id, 'assistant').includes('found it'))
	const events = env.cloud.events(id)
	const nested = events.filter((e) => e.parentToolUseId === 'toolu_agent')
	assert.deepEqual(
		nested.map((e) => e.eventType),
		['tool_call', 'tool_result', 'message'],
	)
	// the subagent's prompt is the Agent call's input, and its usage is not the session's
	assert.ok(!messages(env, id, 'user').includes('look'))
	const keys = env.cloud.requests.map((r) => (r.body as { usageReportKey?: string } | undefined)?.usageReportKey)
	assert.ok(!keys.includes('msg_sub'))
})

test('a reply that reaches the file after its turn ended still leaves the session ready', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	const turn = await c.prompt('late one')
	await c.event({ kind: 'turn-end', turnId: turn, reason: 'answer', contextWindow: 200_000 })
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	// Claude Code writes the reply's line a moment after the turn ended. The API takes it as proof
	// of work and moves the session to running; the mirror says it is ready again.
	c.append(assistant(c.uuid(), 'msg_late', [{ type: 'text', text: 'late reply' }]))
	await waitFor('the late reply', () => messages(env, id, 'assistant').includes('late reply'))
	await waitFor('ready again', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	assert.deepEqual(env.cloud.statuses(id).slice(-2), ['running', 'ready_for_input'])
})

test("a background task's notice is not shown as the user's prompt", async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.hello()
	const id = await bound(env, c)
	c.append({
		type: 'user',
		uuid: c.uuid(),
		message: {
			role: 'user',
			content: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>',
		},
	})
	await c.event({ kind: 'rows' })
	await waitFor('the hidden notice', () =>
		env.cloud.events(id).some((e) => String(e.content).includes('claude_code_task_notification')),
	)
	assert.deepEqual(messages(env, id, 'user'), ['hello'])
})

test('with no transcript path from a hook, the first prompt links to where Claude Code keeps it', async (t) => {
	const env = await setUp(t)
	const c = await env.claude()
	await c.post('/hello', { sessionId: c.sessionId, cwd: env.repo, interactive: false, env: {} })
	await c.event({ kind: 'prompt', text: 'headless', origin: 'user', images: 0 })
	await waitFor('the bind', () => env.cloud.sessions().length === 1)
	const saved = join(env.home, 'claude-code', 'bindings', 'local', `${c.sessionId}.json`)
	await waitFor('the saved binding', () => existsSync(saved))
	const binding = JSON.parse(readFileSync(saved, 'utf8')) as { transcriptPath: string }
	assert.equal(
		binding.transcriptPath,
		join(env.home, '.claude', 'projects', env.repo.replace(/[^a-zA-Z0-9]/g, '-'), `${c.sessionId}.jsonl`),
	)
})
