// The plugin end to end: the real server's hook and tool handling, a fake Codex writing a rollout
// file, the pi extension's mock cloud and diff streams. Linking, the transcript, the task folder,
// the diff, web messages and stops, approvals, crash recovery, and the HumanLayer tools.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { updateControl } from '../src/control.ts'
import { HOOK_TOOL } from '../src/hooks.ts'
import { STOP_REASON } from '../src/mirror.ts'
import { RolloutTail } from '../src/rollout.ts'
import { type Env, FakeCodex, rec, setUp, waitFor } from './helpers/codex.ts'

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

/** Runs a first turn and waits for the link and the turn's end. Returns the cloud session id. */
async function linked(env: Env, prompt = 'hello', reply = 'hi from codex'): Promise<string> {
	const before = env.cloud.sessions().length
	await env.codex.run(prompt, { reply })
	await waitFor('the link', () => env.cloud.sessions().length > before)
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

test('the first prompt links a new codex task, and the turn mirrors from the rollout', async (t) => {
	const env = await setUp(t)
	// History from before the link stays local.
	env.codex.write(rec.user('old prompt'), rec.agent('old reply'))
	const id = await linked(env)

	const session = env.cloud.sessions().at(-1)
	assert.equal(session?.codingAgent, 'codex')
	assert.equal(session?.prompt, 'hello')
	assert.equal(session?.workingDirectory, env.repo)
	assert.match(env.cloud.tasks().at(-1)?.slug ?? '', /^codex-[a-z0-9]{12}$/)
	await waitFor('the reply', () => assistantMessages(env, id).includes('hi from codex'))
	// prepare wrote the first prompt itself, and nothing from before the link went up
	assert.deepEqual(userMessages(env, id), ['hello'])
	assert.ok(!assistantMessages(env, id).includes('old reply'))
	assert.deepEqual(env.cloud.statuses(id).slice(-2), ['running', 'ready_for_input'])
	assert.equal(env.cloud.repositories(id).length, 1)
	const usage = env.cloud.requests.filter(
		(r) => r.path.endsWith('sessions/update') && (r.body as { usageReportKey?: string }).usageReportKey,
	)
	assert.equal(usage.length, 1)
	assert.deepEqual((usage[0]?.body as { modelUsage?: unknown }).modelUsage, {
		'gpt-6-luna': {
			input_tokens: 600,
			output_tokens: 50,
			cache_read_input_tokens: 400,
			cache_creation_input_tokens: 0,
		},
	})
})

test('a shell command goes up as a Bash call when it starts, and its result leads with a failing exit code', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await env.codex.run('run it', { command: { cmd: 'false', output: 'nope', exit: 1 } })

	await waitFor('the result', () => env.cloud.events(id).some((e) => e.eventType === 'tool_result'))
	const call = env.cloud.events(id).find((e) => e.eventType === 'tool_call')
	assert.equal(call?.toolName, 'Bash')
	assert.deepEqual(call?.toolInputJson, { command: 'false' })
	const result = env.cloud.events(id).find((e) => e.eventType === 'tool_result')
	assert.equal(result?.toolResultForId, call?.toolCallId)
	assert.equal(result?.toolResultContent, 'Exit code 1\nnope')
	// one call, though both the hook and the rollout item name it
	assert.equal(env.cloud.events(id).filter((e) => e.eventType === 'tool_call').length, 1)
	assert.deepEqual(userMessages(env, id), ['hello', 'run it'])
})

test('the model hears of the task folder at the link, at a resume, and after a compaction', async (t) => {
	const env = await setUp(t)
	const first = await env.codex.run('hello')
	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	const context = (out: Record<string, unknown>) =>
		String((out.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
	assert.match(context(first), /<artifacts_directory_information>/)
	assert.ok(context(first).includes(`.humanlayer/tasks/${slug}`))
	// once per context, not on every prompt
	assert.equal(context(await env.codex.run('again')), '')
	assert.match(
		context(await env.codex.hook('SessionStart', { source: 'compact' })),
		/artifacts_directory_information/,
	)
})

test('files written to the task folder sync to the task', async (t) => {
	const env = await setUp(t)
	await linked(env)
	const slug = env.cloud.tasks().at(-1)?.slug ?? ''
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	const folder = join(env.repo, '.humanlayer', 'tasks', slug)
	await waitFor('the task folder link', () => existsSync(folder))

	const path = join(folder, 'plan.md')
	writeFileSync(path, '# Plan\n')
	env.codex.write(rec.fileChange('exec-patch-1', path, '# Plan\n'))
	await waitFor('plan.md', () => env.cloud.artifacts(taskId).some((a) => a.fileName === 'plan.md'))
	const id = env.cloud.sessions().at(-1)?.id ?? ''
	// The file and the rollout reach the cloud by separate paths, so either can land first.
	await waitFor('the patch call', () => env.cloud.events(id).some((e) => e.eventType === 'tool_call'))
	const call = env.cloud.events(id).find((e) => e.eventType === 'tool_call')
	assert.equal(call?.toolName, 'apply_patch')
	assert.match(
		String((call?.toolInputJson as { patch_text?: string }).patch_text),
		/\*\*\* Add File: .*plan\.md\n\+# Plan/,
	)
})

test('the task diff goes up for a task the session made, without env files', async (t) => {
	const env = await setUp(t)
	await linked(env)
	const taskId = env.cloud.sessions().at(-1)?.taskId ?? ''
	const orgId = env.cloud.state.orgs[0]?.internalOrgId ?? ''
	writeFileSync(join(env.repo, 'calc.py'), 'def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n')
	writeFileSync(join(env.repo, '.env'), 'SECRET=1\n')
	await env.codex.run('edit', { command: { cmd: 'echo', output: '' } })

	const files = () => [...env.streams.state(orgId, taskId).files.values()].map((f) => f.path)
	await waitFor('the diff', () => files().includes('calc.py'))
	assert.deepEqual(files(), ['calc.py'])
})

test('a web message goes to Codex through codex queue, runs, and its user message is not sent twice', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)
	env.cloud.continueSession(id, 'from the web')

	await waitFor('codex queue', () => env.codex.queued.length === 1)
	assert.deepEqual(env.codex.queued[0], { threadId: env.codex.threadId, text: 'from the web' })
	await waitFor('the reply', () => assistantMessages(env, id).includes('done: from the web'))
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	// the mock wrote the web message's user event; the rollout's copy stays home
	assert.equal(userMessages(env, id).filter((m) => m === 'from the web').length, 1)
})

test('a web message naming a skill becomes a $skill mention', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)
	env.cloud.continueSession(id, '/create-research the parser')
	await waitFor('codex queue', () => env.codex.queued.length === 1)
	assert.equal(env.codex.queued[0]?.text, '$create-research the parser')
})

test('a web message to a session no Codex has open waits in its queue, and the session waits for input', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await env.codex.plugin.shutdown()
	// Another Codex, in another thread, opens in the folder.
	const other = env.another()
	other.runQueued = false
	await other.plugin.start()
	await following(env)
	env.cloud.continueSession(id, 'while you were out')

	await waitFor('codex queue', () => other.queued.length === 1)
	assert.deepEqual(other.queued[0], { threadId: env.codex.threadId, text: 'while you were out' })
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')

	// The user resumes the thread: the queued message runs, and goes up once.
	await env.codex.restart()
	await env.codex.hook('SessionStart', { source: 'resume' })
	await env.codex.run('while you were out', { reply: 'back' })
	await waitFor('the reply', () => assistantMessages(env, id).includes('back'))
	assert.equal(userMessages(env, id).filter((m) => m === 'while you were out').length, 1)
})

test('the web stop marks an idle session interrupted, and ends a running turn at its next step', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)
	env.cloud.interruptSession(id)
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')

	// A turn that is running when the stop comes.
	await env.codex.hook('UserPromptSubmit', { turn_id: 't2', prompt: 'long job' })
	env.codex.write(rec.taskStarted('t2'), rec.user('long job'))
	await waitFor('running', () => env.cloud.statuses(id).at(-1) === 'running')
	env.cloud.interruptSession(id)
	const tool = { turn_id: 't2', tool_name: 'Bash', tool_use_id: 'exec-stop', tool_input: { command: 'make' } }
	await waitFor('the next tool call denied', async () => {
		const out = await env.codex.hook('PreToolUse', tool)
		return JSON.stringify(out).includes(STOP_REASON)
	})
	const stop = await env.codex.hook('Stop', { turn_id: 't2', stop_hook_active: false })
	assert.equal(stop.continue, false)
	env.codex.write(rec.agent('stopping'), rec.taskComplete('t2'))
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')
	// the denied call still has its result
	const result = env.cloud.events(id).find((e) => e.eventType === 'tool_result' && e.toolResultForId === 'exec-stop')
	assert.equal(result?.toolResultContent, STOP_REASON)
})

test('an approval waits for the web app on its tool call; an approve allows, a deny carries its comment', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)

	const ask = async (n: number) => {
		const tool = {
			turn_id: `t${n}`,
			tool_name: 'Bash',
			tool_use_id: `exec-${n}`,
			tool_input: { command: `touch ${n}` },
		}
		await env.codex.hook('PreToolUse', tool)
		return env.codex.hook('PermissionRequest', {
			turn_id: `t${n}`,
			tool_name: 'Bash',
			tool_input: { command: `touch ${n}` },
		})
	}
	const first = ask(1)
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	const approval = env.cloud.approvals(id)[0]
	assert.equal(approval?.toolName, 'Bash')
	assert.equal(approval?.toolUseId, 'exec-1')
	env.cloud.resolveApproval(approval?.id ?? '', 'approve')
	assert.deepEqual((await first).hookSpecificOutput, {
		hookEventName: 'PermissionRequest',
		decision: { behavior: 'allow' },
	})

	const second = ask(2)
	await waitFor('the second approval', () => env.cloud.approvals(id).length === 2)
	env.cloud.resolveApproval(env.cloud.approvals(id)[1]?.id ?? '', 'deny', 'use echo')
	assert.deepEqual((await second).hookSpecificOutput, {
		hookEventName: 'PermissionRequest',
		decision: { behavior: 'deny', message: 'use echo' },
	})
})

test('a web stop denies a waiting approval', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)
	await env.codex.hook('UserPromptSubmit', { turn_id: 't2', prompt: 'risky' })
	env.codex.write(rec.taskStarted('t2'))
	await waitFor('running', () => env.cloud.statuses(id).at(-1) === 'running')
	const asked = env.codex.hook('PermissionRequest', {
		turn_id: 't2',
		tool_name: 'Bash',
		tool_input: { command: 'rm -rf x' },
	})
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	env.cloud.interruptSession(id)
	const out = (await asked).hookSpecificOutput as { decision: { behavior: string } }
	assert.equal(out.decision.behavior, 'deny')
	// and the web app no longer offers it
	await waitFor('denied in the cloud', () => env.cloud.approvals(id)[0]?.status === 'denied')
})

test('with no web answer in time, Codex asks in the terminal, and its answer reaches the web app', async (t) => {
	const env = await setUp(t, { env: { HUMANLAYER_CODEX_APPROVAL_WAIT: '0.3' } })
	const id = await linked(env)
	const tool = { turn_id: 't2', tool_name: 'Bash', tool_use_id: 'exec-t', tool_input: { command: 'touch t' } }
	await env.codex.hook('PreToolUse', tool)
	const out = await env.codex.hook('PermissionRequest', {
		turn_id: 't2',
		tool_name: 'Bash',
		tool_input: { command: 'touch t' },
	})
	assert.deepEqual(out, {})
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	// The user approves in the terminal: the command runs.
	await env.codex.hook('PostToolUse', { ...tool, tool_response: '' })
	await waitFor('approved', () => env.cloud.approvals(id)[0]?.status === 'approved')
})

test('a run whose Codex died ends interrupted, and what it never sent goes up, when a Codex starts', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await env.codex.plugin.shutdown()
	// A Codex runs a turn and dies with it: its server noted the run, then never read the rest.
	const binding = join(env.home, 'codex', 'bindings', 'local', `${env.codex.threadId}.json`)
	const saved = JSON.parse(readFileSync(binding, 'utf8'))
	writeFileSync(binding, JSON.stringify({ ...saved, running: { pid: 999_999, approvalIds: [] }, owner: 999_999 }))
	env.codex.write(rec.taskStarted('t2'), rec.user('crash soon'), rec.agent('last words'))
	const next = env.another()
	await next.plugin.start()
	await waitFor('the unsent reply', () => assistantMessages(env, id).includes('last words'))
	await waitFor('interrupted', () => env.cloud.statuses(id).at(-1) === 'interrupted')
	await waitFor('the cleared run to be saved', () => !JSON.parse(readFileSync(binding, 'utf8')).running)
})

test('an approval outlives its turn: Codex can end a turn while a background command waits for one', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await following(env)
	await env.codex.hook('UserPromptSubmit', { turn_id: 't2', prompt: 'write it' })
	env.codex.write(rec.taskStarted('t2'))
	const tool = { turn_id: 't2', tool_name: 'Bash', tool_use_id: 'exec-bg', tool_input: { command: 'cat > x' } }
	await env.codex.hook('PreToolUse', tool)
	const asked = env.codex.hook('PermissionRequest', {
		turn_id: 't2',
		tool_name: 'Bash',
		tool_input: { command: 'cat > x' },
	})
	await waitFor('the approval', () => env.cloud.approvals(id).length === 1)
	// The model gives up waiting and ends the turn; the command still waits.
	env.codex.write(rec.agent('still pending'), rec.taskComplete('t2'))
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	env.cloud.resolveApproval(env.cloud.approvals(id)[0]?.id ?? '', 'approve')
	const out = (await asked).hookSpecificOutput as { decision: { behavior: string } }
	assert.equal(out.decision.behavior, 'allow')
	// The web app's answer moved the session to running; no turn runs, so it waits for input again.
	await waitFor('ready_for_input again', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	// The command runs and Codex writes its result after the turn: still no turn runs.
	const before = env.cloud.statuses(id).length
	env.codex.write(rec.command('exec-bg', 'cat > x', ''))
	await waitFor('the late result', () =>
		env.cloud.events(id).some((e) => e.eventType === 'tool_result' && e.toolResultForId === 'exec-bg'),
	)
	// The API moves the session to running on the late result; the plugin says ready_for_input again.
	await waitFor(
		'ready_for_input after it',
		() => env.cloud.statuses(id).length > before && env.cloud.statuses(id).at(-1) === 'ready_for_input',
	)
})

test("a subagent's work shows under the Task call that ran it, which ends with its last reply", async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	const child = 'child-thread-0001'
	const childRollout = join(dirname(env.codex.rollout), `rollout-x-${child}.jsonl`)
	env.codex.write(
		rec.taskStarted('t2'),
		rec.item({
			type: 'SubAgentActivity',
			id: 'call_spawn',
			kind: 'started',
			agent_thread_id: child,
			agent_path: '/root/counter',
		}),
	)
	// The child's rollout repeats the parent's history for its model; only its own items map.
	writeFileSync(
		childRollout,
		[
			{
				type: 'response_item',
				payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
			},
			rec.command('exec-child', 'grep -c def todo.py', '3'),
			rec.agent('three functions'),
		]
			.map((r) => JSON.stringify(r))
			.join('\n') + '\n',
	)
	env.codex.write(
		rec.item({
			type: 'SubAgentActivity',
			id: 'sub-done',
			kind: 'completed',
			agent_thread_id: child,
			agent_path: '/root/counter',
		}),
		rec.agent('The subagent says three.'),
		rec.taskComplete('t2'),
	)
	await waitFor('the Task result', () =>
		env.cloud.events(id).some((e) => e.eventType === 'tool_result' && e.toolResultForId === 'call_spawn'),
	)
	const events = env.cloud.events(id)
	const task = events.find((e) => e.toolCallId === 'call_spawn' && e.eventType === 'tool_call')
	assert.equal(task?.toolName, 'Task')
	const nested = events.filter((e) => e.parentToolUseId === 'call_spawn')
	assert.deepEqual(
		nested.map((e) => e.eventType),
		['tool_call', 'tool_result', 'message'],
	)
	assert.equal(events.find((e) => e.toolResultForId === 'call_spawn')?.toolResultContent, 'three functions')
	assert.ok(!assistantMessages(env, id).includes('hello'))
})

test('a resumed thread keeps its cloud session, and sends only what the cloud never took', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await env.codex.plugin.shutdown()
	// Codex wrote more while the plugin was not running.
	env.codex.write(rec.agent('written while away'))
	await env.codex.restart()
	await env.codex.hook('SessionStart', { source: 'resume' })
	await env.codex.run('next', { reply: 'after resume' })
	await waitFor('after resume', () => assistantMessages(env, id).includes('after resume'))
	assert.equal(env.cloud.sessions().length, 1)
	assert.equal(assistantMessages(env, id).filter((m) => m === 'hi from codex').length, 1)
	assert.ok(assistantMessages(env, id).includes('written while away'))
})

test('attach before Codex starts: the next new session in the folder joins that task, once', async (t) => {
	const env = await setUp(t)
	const task = env.cloud.seedTask({ slug: 'my-task' })
	await updateControl((c) => {
		c.nextAttach = { target: 'my-task', cwd: env.repo, at: new Date().toISOString() }
	})
	await linked(env)
	assert.equal(env.cloud.sessions().at(-1)?.taskId, task.id)
	const other = env.another()
	await other.plugin.start()
	await other.run('second')
	await waitFor('the second link', () => env.cloud.sessions().length === 2)
	assert.notEqual(env.cloud.sessions().at(-1)?.taskId, task.id)
})

test('off and on, from humanlayer-codex', async (t) => {
	const env = await setUp(t)
	const id = await linked(env)
	await updateControl((c) => {
		c.threads = { [env.codex.threadId]: { off: true, at: '' } }
	})
	await env.codex.run('quiet', { reply: 'not sent' })
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	await new Promise((r) => setTimeout(r, 400))
	assert.ok(!assistantMessages(env, id).includes('not sent'))
	// Hold the resume boundary lookup open so the idle timer consumes `on` before
	// the next hook. That hook must still wait, rather than write a turn we skip.
	const size = RolloutTail.size
	let readingSize = false
	let releaseSize!: () => void
	const resume = new Promise<void>((resolve) => {
		releaseSize = resolve
	})
	const sizeMock = t.mock.method(RolloutTail, 'size', async (path: string) => {
		readingSize = true
		await resume
		return size(path)
	})
	await updateControl((c) => {
		c.threads = { [env.codex.threadId]: { off: false, at: '' } }
	})
	await waitFor('the resume boundary lookup', () => readingSize)
	let submitted = false
	const prompt = env.codex.hook('UserPromptSubmit', { prompt: 'loud' }).then(() => {
		submitted = true
	})
	try {
		assert.equal(env.codex.plugin.mirrors.get(env.codex.threadId)?.info().state, 'off')
		await new Promise<void>((resolve) => setImmediate(resolve))
		assert.equal(submitted, false, 'the prompt must wait for the resume boundary')
	} finally {
		releaseSize()
		await prompt
		sizeMock.mock.restore()
	}
	await env.codex.run('loud', { reply: 'sent again' })
	await waitFor('sent again', () => assistantMessages(env, id).includes('sent again'))
	assert.ok(!userMessages(env, id).includes('quiet'))
})

test('the HumanLayer tools run on the linked task, and the hook tool stays out of the list', async (t) => {
	const env = await setUp(t)
	await linked(env)
	env.cloud.stub('comments/get', { comments: [], validArtifacts: ['research.md'] })
	const names = env.codex.plugin.tools().map((tool) => tool.name)
	assert.ok(names.includes('get_artifact_comments'))
	assert.ok(!names.includes(HOOK_TOOL))
	const out = await env.codex.plugin.call(
		'get_artifact_comments',
		{ artifact_filename: 'research.md' },
		{ threadId: env.codex.threadId, signal: AbortSignal.timeout(5000) },
	)
	assert.equal(out.isError ?? false, false)
	const unlinked = await env.codex.plugin.call(
		'get_artifact_comments',
		{ artifact_filename: 'research.md' },
		{ threadId: 'another-thread', signal: AbortSignal.timeout(5000) },
	)
	assert.equal(unlinked.isError, true)
	assert.match(unlinked.text, /not linked/)
})

test('a session the HumanLayer daemon runs is never mirrored a second time', async (t) => {
	const env = await setUp(t, { start: false, env: { HUMANLAYER_SESSION_ID: 'daemon-session' } })
	const fresh = env.another()
	await fresh.plugin.start()
	assert.deepEqual(await fresh.run('hello'), {})
	await new Promise((r) => setTimeout(r, 300))
	assert.equal(env.cloud.sessions().length, 0)
	assert.deepEqual(fresh.plugin.tools(), [])
})

test('signed out, a prompt does not link, and Codex hears why once', async (t) => {
	const env = await setUp(t, { pat: false })
	const out = await env.codex.run('hello')
	assert.match(String(out.systemMessage), /humanlayer-codex login/)
	const again = await env.codex.run('again')
	assert.equal(again.systemMessage, undefined)
	assert.equal(env.cloud.sessions().length, 0)
})
