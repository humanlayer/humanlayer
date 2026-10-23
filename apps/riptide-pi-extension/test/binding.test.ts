// binding.ts on its own: task pick order, the worktree task link, git facts (detached HEAD
// included), the prepare and repositories/report bodies against contracts.ts, and the identity
// check on load. Temp dirs only; no network.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { hostId } from '../src/auth.ts'
import {
	type Binding,
	gitInfo,
	loadBinding,
	newTask,
	pickTask,
	prepareBody,
	promptText,
	recordLink,
	repositoriesReport,
	saveBinding,
	sessionTitle,
	stripUserinfo,
} from '../src/binding.ts'
import { repositoriesReportInput, runPrepareInput } from './helpers/contracts.ts'
import { withEnv } from './helpers/harness.ts'

const PI_ID = '0198c0de-1234-7abc-8def-0123456789ab'
const TASK_ID = '0198c0de-aaaa-7bbb-8ccc-dddddddddddd'

function tempDir(t: TestContext, prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
	t.after(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

function linkTask(cwd: string, slug: string, target: string): void {
	mkdirSync(join(cwd, '.humanlayer', 'tasks'), { recursive: true })
	symlinkSync(target, join(cwd, '.humanlayer', 'tasks', slug))
}

function git(cwd: string, ...args: string[]): string {
	const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env })
		.toString()
		.trim()
}

test('pickTask: attach, then the flag, then HUMANLAYER_TASK, then the task link, else create', async (t) => {
	const cwd = tempDir(t, 'pi-hl-pick-')
	linkTask(cwd, 'linked-task', `/home/u/.humanlayer/riptide/artifacts/${TASK_ID}`)
	withEnv(t, { HUMANLAYER_TASK: 'env-task', HUMANLAYER_RIPTIDE_HOME: tempDir(t, 'pi-hl-home-') })

	assert.deepEqual(await pickTask(PI_ID, cwd, 'attached', 'flagged'), {
		taskMode: 'use',
		taskIdOrSlug: 'attached',
		taskSlug: 'attached',
	})
	assert.deepEqual(await pickTask(PI_ID, cwd, undefined, 'flagged'), {
		taskMode: 'use',
		taskIdOrSlug: 'flagged',
		taskSlug: 'flagged',
	})
	assert.deepEqual(await pickTask(PI_ID, cwd, undefined, ''), {
		taskMode: 'use',
		taskIdOrSlug: 'env-task',
		taskSlug: 'env-task',
	})
	delete process.env.HUMANLAYER_TASK
	assert.deepEqual(await pickTask(PI_ID, cwd), {
		taskMode: 'use',
		taskIdOrSlug: TASK_ID,
		taskSlug: 'linked-task',
		auto: true,
	})
	// "new" skips the link. The flag's is the session's own task; `attach new` makes a fresh one each time.
	assert.deepEqual(await pickTask(PI_ID, cwd, undefined, 'new'), {
		taskMode: 'ensure',
		slug: 'pi-0123456789ab',
	})
	const fresh = await pickTask(PI_ID, cwd, 'new')
	assert.equal(fresh.taskMode, 'ensure')
	assert.notDeepEqual(fresh, { taskMode: 'ensure', slug: 'pi-0123456789ab' })
	assert.notDeepEqual(await pickTask(PI_ID, cwd, 'new'), fresh)
	// A uuid has no slug to show.
	assert.deepEqual(await pickTask(PI_ID, cwd, TASK_ID), {
		taskMode: 'use',
		taskIdOrSlug: TASK_ID,
		taskSlug: undefined,
	})
	assert.deepEqual(await pickTask(PI_ID, tempDir(t, 'pi-hl-pick-')), {
		taskMode: 'ensure',
		slug: 'pi-0123456789ab',
	})
})

test('pickTask: the task link must be the only symlink into artifacts/<uuid>', async (t) => {
	const cwd = tempDir(t, 'pi-hl-link-')
	withEnv(t, { HUMANLAYER_RIPTIDE_HOME: tempDir(t, 'pi-hl-home-') })
	linkTask(cwd, 'not-a-task', '/somewhere/else')
	writeFileSync(join(cwd, '.humanlayer', 'tasks', 'plain-file'), 'x')
	linkTask(cwd, 'only', `/a/artifacts/${TASK_ID}/`)
	assert.equal((await pickTask(PI_ID, cwd)).taskMode, 'use')

	linkTask(cwd, 'second', '/b/artifacts/0198c0de-bbbb-7bbb-8ccc-dddddddddddd')
	assert.equal((await pickTask(PI_ID, cwd)).taskMode, 'ensure')
})

test("pickTask: a link this extension made is never the worktree's task", async (t) => {
	const cwd = tempDir(t, 'pi-hl-own-')
	withEnv(t, { HUMANLAYER_RIPTIDE_HOME: tempDir(t, 'pi-hl-home-') })
	linkTask(cwd, 'pi-earlier', `/home/u/.humanlayer/riptide/artifacts/${TASK_ID}`)
	await recordLink(join(cwd, '.humanlayer', 'tasks', 'pi-earlier'), TASK_ID)
	assert.deepEqual(await pickTask(PI_ID, cwd), { taskMode: 'ensure', slug: 'pi-0123456789ab' })

	// The daemon's link beside it is still found, even with its task in the record for another path.
	const other = '0198c0de-bbbb-7bbb-8ccc-dddddddddddd'
	linkTask(cwd, 'worktree-task', `/home/u/.humanlayer/riptide/artifacts/${other}`)
	await recordLink(join(tempDir(t, 'pi-hl-elsewhere-'), 'worktree-task'), other)
	assert.deepEqual(await pickTask(PI_ID, cwd), {
		taskMode: 'use',
		taskIdOrSlug: other,
		taskSlug: 'worktree-task',
		auto: true,
	})
})

test(
	'recordLink creates private state under a permissive umask without changing existing directories',
	{ skip: process.platform === 'win32' },
	async (t) => {
		const root = tempDir(t, 'pi-hl-modes-')
		withEnv(t, { HUMANLAYER_RIPTIDE_HOME: root })
		const previous = process.umask(0)
		try {
			for (const existing of [false, true]) {
				const home = join(root, String(existing))
				mkdirSync(home, { mode: 0o755 })
				const dir = join(home, 'pi')
				if (existing) mkdirSync(dir, { mode: 0o750 })
				process.env.HUMANLAYER_RIPTIDE_HOME = home
				const path = join(root, 'task-link')
				await recordLink(path, TASK_ID)
				await recordLink(path, TASK_ID)
				assert.equal(statSync(home).mode & 0o777, 0o755)
				assert.equal(statSync(dir).mode & 0o777, existing ? 0o750 : 0o700)
				const ledger = join(dir, 'task-links.jsonl')
				assert.equal(statSync(ledger).mode & 0o777, 0o600)
				assert.deepEqual(
					readFileSync(ledger, 'utf8')
						.trim()
						.split(/\n+/)
						.map((line) => JSON.parse(line)),
					[
						[path, TASK_ID],
						[path, TASK_ID],
					],
				)
			}
		} finally {
			process.umask(previous)
		}
	},
)

test('own links survive a new process, cwd aliases, and a partial last record', async (t) => {
	const home = tempDir(t, 'pi-hl-home-')
	const cwd = tempDir(t, 'pi-hl-restart-')
	const alias = join(tempDir(t, 'pi-hl-alias-'), 'workspace')
	withEnv(t, { HUMANLAYER_RIPTIDE_HOME: home, HUMANLAYER_TASK: undefined })
	symlinkSync(cwd, alias)
	linkTask(cwd, 'earlier', `/store/artifacts/${TASK_ID}`)
	mkdirSync(join(home, 'pi'))
	writeFileSync(join(home, 'pi', 'task-links.jsonl'), '["partial')
	await recordLink(join(alias, '.humanlayer', 'tasks', 'earlier'), TASK_ID)
	const moduleUrl = new URL('../src/binding.ts', import.meta.url).href
	const script = `import { pickTask } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await pickTask(${JSON.stringify(PI_ID)}, ${JSON.stringify(alias)})));`
	const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		env: process.env,
		encoding: 'utf8',
	})
	assert.deepEqual(JSON.parse(output), newTask(PI_ID))
	// Replacing the same path with a different daemon task must not hide it.
	const other = '0198c0de-bbbb-7bbb-8ccc-dddddddddddd'
	unlinkSync(join(cwd, '.humanlayer', 'tasks', 'earlier'))
	linkTask(cwd, 'earlier', `/store/artifacts/${other}`)
	assert.deepEqual(await pickTask(PI_ID, alias), {
		taskMode: 'use',
		taskIdOrSlug: other,
		taskSlug: 'earlier',
		auto: true,
	})
})

test('only explicit attach new is fresh; flag, environment and fallback slugs stay stable', async (t) => {
	const cwd = tempDir(t, 'pi-hl-new-')
	withEnv(t, { HUMANLAYER_TASK: 'new', HUMANLAYER_RIPTIDE_HOME: tempDir(t, 'pi-hl-home-') })
	assert.deepEqual(await pickTask(PI_ID, cwd), newTask(PI_ID))
	assert.deepEqual(await pickTask(PI_ID, cwd, undefined, 'new'), newTask(PI_ID))
	const fresh = await pickTask(PI_ID, cwd, 'new', 'existing-task')
	assert.equal(fresh.taskMode, 'ensure')
	assert.notDeepEqual(fresh, newTask(PI_ID))
	assert.notDeepEqual(await pickTask(PI_ID, cwd, 'new'), fresh)
})

test('gitInfo: root, HEAD, branch and a cleaned origin; branch is empty on a detached HEAD', async (t) => {
	assert.equal(await gitInfo(tempDir(t, 'pi-hl-nogit-')), undefined)

	const root = tempDir(t, 'pi-hl-git-')
	git(root, 'init', '-q', '-b', 'main')
	assert.deepEqual(await gitInfo(root), { root, branch: 'main' }) // no commits yet: no headSha

	git(root, 'commit', '-q', '--allow-empty', '-m', 'one')
	git(root, 'remote', 'add', 'origin', 'https://user:secret@github.com/acme/app.git')
	const sha = git(root, 'rev-parse', 'HEAD')
	mkdirSync(join(root, 'sub'))
	assert.deepEqual(await gitInfo(join(root, 'sub')), {
		root,
		headSha: sha,
		branch: 'main',
		remoteUrl: 'https://github.com/acme/app.git',
	})

	git(root, 'checkout', '-q', '--detach')
	const detached = await gitInfo(root)
	assert.equal(detached?.branch, '')
	assert.deepEqual(repositoriesReport(detached!).repositories[0], {
		localPath: root,
		remoteUrl: 'https://github.com/acme/app.git',
	})
})

test('stripUserinfo keeps scp-style remotes and local paths as they are', () => {
	assert.equal(stripUserinfo('git@github.com:acme/app.git'), 'git@github.com:acme/app.git')
	assert.equal(stripUserinfo('/srv/repos/app.git'), '/srv/repos/app.git')
	assert.equal(stripUserinfo('ssh://git@host/app.git'), 'ssh://host/app.git')
})

test('prepareBody matches the prepare contract for ensure and use', (t) => {
	withEnv(t, { HUMANLAYER_PI_CODING_AGENT: undefined })
	const git = { root: '/w/app', headSha: 'abc123', branch: '', remoteUrl: 'https://github.com/acme/app.git' }
	const common = { hostId: TASK_ID, title: 'Fix the bug', prompt: 'Fix the bug\nplease', cwd: '/w/app/src', git }

	const ensure = prepareBody({ ...common, pick: { taskMode: 'ensure', slug: 'pi-0123456789ab' } })
	const parsed = runPrepareInput.parse(ensure)
	assert.equal(ensure.codingAgent, 'pi') // sent, not left to the "codelayer" default
	assert.equal('provider' in ensure || 'model' in ensure, false) // no ctx.model: left to server defaults
	assert.equal(parsed.taskMode === 'ensure' && parsed.task.hostId, undefined)
	assert.deepEqual(parsed.taskMode === 'ensure' && parsed.task.workspaceState, {
		workspaceBaseDirectory: '/w',
		repos: [
			{
				path: 'app',
				sourceRef: 'HEAD',
				sourceCommit: 'abc123',
				branch: '',
				primary: true,
				remoteUrl: 'https://github.com/acme/app.git',
			},
		],
	})

	const model = { provider: 'anthropic', id: 'claude-sonnet-4-5' }
	const use = prepareBody({ ...common, model, pick: { taskMode: 'use', taskIdOrSlug: 'my-task' } })
	assert.deepEqual(runPrepareInput.parse(use), use) // nothing left to defaults
	assert.equal('task' in use, false)

	const report = { sessionId: TASK_ID, ...repositoriesReport({ ...git, branch: 'main' }) }
	assert.deepEqual(repositoriesReportInput.parse(report).repositories[0]?.branch, 'main')
})

test('sessionTitle and promptText never give the server an empty string', () => {
	assert.equal(sessionTitle('  named  ', 'prompt'), 'named')
	assert.equal(sessionTitle(undefined, '\n\n  first line  \nsecond'), 'first line')
	assert.equal(sessionTitle(undefined, 'x'.repeat(100)).length, 80)
	assert.equal(sessionTitle(undefined, '   '), 'pi session')
	assert.equal(promptText('look', 2), 'look\n[image]\n[image]')
	assert.equal(promptText('', 0), '(empty prompt)')
})

test('loadBinding drops a binding made for another channel, host, user or org', async (t) => {
	withEnv(t, { HUMANLAYER_RIPTIDE_HOME: tempDir(t, 'pi-hl-home-') })
	const host = await hostId('local')
	const who = { channel: 'local' as const, source: 'device' as const, userId: 'user_1', orgId: 'org-uuid-1' }
	const binding: Binding = {
		version: 1,
		channel: 'local',
		piSessionId: PI_ID,
		cwd: '/w',
		createdAt: new Date().toISOString(),
		taskMode: 'ensure',
		hostId: host,
		cursor: { n: 3, lastId: 'e3' },
		cloudSessionId: TASK_ID,
		userId: 'user_1',
		orgId: 'org-uuid-1',
	}
	await saveBinding(binding)

	assert.deepEqual(await loadBinding('local', PI_ID, who), binding)
	assert.equal(await loadBinding('local', PI_ID, { ...who, userId: 'user_2' }), undefined)
	assert.equal(await loadBinding('local', PI_ID, { ...who, orgId: 'org-uuid-2' }), undefined)
	assert.deepEqual(await loadBinding('local', PI_ID, { channel: 'local', source: 'pat' }), binding) // a PAT carries no ids
	await saveBinding({ ...binding, hostId: TASK_ID })
	assert.equal(await loadBinding('local', PI_ID, who), undefined)
	await saveBinding({ ...binding, channel: 'dev' })
	assert.equal(await loadBinding('dev', PI_ID, { ...who, channel: 'dev' }), undefined) // wrong channel dir and host
	await saveBinding({ ...binding, cloudSessionId: undefined })
	assert.equal(await loadBinding('local', PI_ID, who), undefined) // a pending binding is never used
})
