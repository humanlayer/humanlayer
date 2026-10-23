// The small pure parts: skills, the footer and status text, web action claims, and claim keys.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { claim, claimKey, pruneClaims } from '@humanlayer/session-sdk-sessions'

import { bundledSkillsDir } from '../src/config.ts'
import type { StatusOutput } from '../src/rpc.ts'
import { loadSkills, skillsReport, slashCommand } from '../src/skills.ts'
import { footer, statusText } from '../src/status.ts'

test('slashCommand splits a leading /name from its arguments', () => {
	assert.deepEqual(slashCommand('/show-me calc.py'), { name: 'show-me', args: 'calc.py' })
	assert.deepEqual(slashCommand('  /compact  '), { name: 'compact', args: '' })
	assert.deepEqual(slashCommand('/review a\nb'), { name: 'review', args: 'a\nb' })
	assert.equal(slashCommand('not a command'), undefined)
	assert.equal(slashCommand('/path/to/file is broken'), undefined)
})

test('loadSkills reads each SKILL.md, its name and description, sorted', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'oc-skills-'))
	mkdirSync(join(dir, 'b-skill'))
	writeFileSync(join(dir, 'b-skill', 'SKILL.md'), '---\nname: bee\ndescription: The second\n---\nbody')
	mkdirSync(join(dir, 'a-skill'))
	writeFileSync(join(dir, 'a-skill', 'SKILL.md'), 'no frontmatter')
	mkdirSync(join(dir, 'empty'))
	const skills = await loadSkills(dir)
	assert.deepEqual(
		skills.map((s) => [s.id, s.name, s.description]),
		[
			['a-skill', 'a-skill', undefined],
			['bee', 'bee', 'The second'],
		],
	)
	assert.deepEqual(await loadSkills(join(dir, 'missing')), [])
})

test('the bundled skills are there', async () => {
	const names = (await loadSkills(bundledSkillsDir())).map((s) => s.name)
	for (const name of ['create-research', 'create-tech-design', 'implement-plan', 'show-me'])
		assert.ok(names.includes(name))
})

test('skillsReport scopes skills by where they live', () => {
	const report = skillsReport({
		hostId: 'host-1',
		workspace: '/work/repo',
		skills: [
			{ name: 'mine', path: '/work/repo/.opencode/skills/mine/SKILL.md', description: 'd' },
			{ name: 'global', path: join(homedir(), '.config/opencode/skills/global/SKILL.md') },
			{ name: 'ours', path: '/plugins/hl/skills/ours/SKILL.md' },
			{ name: 'builtin', path: '/opt/opencode/SKILL.md' },
		],
		commands: [{ name: 'review', description: 'review changes' }, { name: 'init' }],
		bundled: new Set(['/plugins/hl/skills/ours/SKILL.md']),
	})
	assert.equal(report.agent, 'opencode')
	assert.equal(report.workspacePath, '/work/repo')
	assert.deepEqual(
		report.skills.map((s) => [s.name, s.scope]),
		[
			['mine', 'project'],
			['global', 'user'],
			['ours', 'plugin'],
			['builtin', 'plugin'],
		],
	)
	assert.deepEqual(report.commands, [{ name: 'review', description: 'review changes' }, { name: 'init' }])
})

const signedIn: StatusOutput = { channel: 'prod', signedIn: { email: 'a@b.c', org: 'Acme', source: 'device' } }

test('the footer says what the session needs, most urgent first', () => {
	assert.equal(footer(undefined), '')
	assert.equal(footer({ channel: 'prod' }), 'HumanLayer: /humanlayer login')
	assert.equal(footer({ channel: 'prod', pending: { url: 'u', code: 'c' } }), 'HumanLayer: signing in…')
	assert.equal(footer({ channel: 'prod', disabled: true }), 'HumanLayer: disabled')
	assert.equal(footer({ ...signedIn, loginRequired: true }), 'HumanLayer: ⚠ login required')
	assert.equal(footer(signedIn), 'HumanLayer: ready')
	assert.equal(footer({ ...signedIn, session: { state: 'unbound', queued: 0 } }), 'HumanLayer: ready')
	assert.equal(footer({ ...signedIn, session: { state: 'off', queued: 0, task: 't' } }), 'HumanLayer: off')
	assert.equal(
		footer({ ...signedIn, session: { state: 'unbound', queued: 0, attach: 'new' } }),
		'HumanLayer: next prompt → new task',
	)
	assert.equal(
		footer({ ...signedIn, session: { state: 'mirroring', queued: 3, task: 'eng-1', synced: 'plan.md' } }),
		'HumanLayer: eng-1 ↑3 · plan.md',
	)
	const long = 'task eng-1 not found. Use /humanlayer attach <task> or /humanlayer attach new.'
	const stopped = footer({ ...signedIn, session: { state: 'stopped', queued: 0, problem: long } })
	assert.ok(stopped.startsWith('HumanLayer: ⚠ task eng-1 not found'))
	assert.ok(stopped.endsWith('…'))
})

test('status text lists the facts', () => {
	const text = statusText({
		...signedIn,
		session: { state: 'mirroring', queued: 2, task: 'eng-1', url: 'https://app/s/1', synced: 'plan.md' },
	})
	for (const line of [
		'Channel: prod',
		'Signed in as a@b.c',
		'Organization: Acme',
		'Mirroring: on',
		'Task: eng-1',
		'Session: https://app/s/1',
		'Waiting to send: 2',
		'Last task file: plan.md',
	])
		assert.ok(text.includes(line), line)
	assert.match(statusText({ channel: 'beta' }), /Not signed in/)
	assert.match(statusText({ channel: 'beta', signedIn: { source: 'pat' } }), /HUMANLAYER_PAT/)
})

test('a claim goes to the first taker only, and old claims are pruned', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'oc-claims-')), 'claims')
	const results = await Promise.all([claim(dir, 'k:1/x'), claim(dir, 'k:1/x'), claim(dir, 'k:1/x')])
	assert.deepEqual(results.filter(Boolean).length, 1)
	assert.equal(await claim(dir, 'k2'), true)

	const old = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000
	utimesSync(join(dir, 'k_1_x'), old, old)
	await pruneClaims(dir)
	assert.equal(await claim(dir, 'k:1/x'), true, 'pruned, so free again')
	assert.equal(await claim(dir, 'k2'), false, 'recent, so kept')
})

test('claim keys differ per web action on a row', () => {
	const row = { id: 's1', status: 'resuming', prompt: 'hi', updated_at: '100' }
	assert.equal(claimKey(row), claimKey({ ...row }))
	assert.notEqual(claimKey(row), claimKey({ ...row, updated_at: '101' }))
	assert.notEqual(claimKey(row), claimKey({ ...row, prompt: 'hello' }))
	assert.notEqual(claimKey(row), claimKey({ ...row, status: 'interrupt_requested' }))
})
