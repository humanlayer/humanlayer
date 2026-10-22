#!/usr/bin/env node
// humanlayer-codex: what pi and opencode do with `/humanlayer`, from a shell, since Codex has no
// plugin slash commands.
//
//   login [channel]                 signs in (device code, then an org)
//   logout [channel]                signs out
//   status                          sign-in, and the Codex sessions in this folder
//   attach <task id|slug|new>       the next prompt starts a session in that task
//   off | on                        stops or restarts sending a session
//
// attach, off and on act on the one Codex session open in this folder, or the one named with
// --thread <id>. attach with none open applies to the next new session here, even after a restart.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import type { OrgChoice } from '@humanlayer/session-sdk-auth'
import {
	ALL_CHANNELS,
	type Channel,
	errorMessage,
	getChannelConfig,
	isChannel,
	readJsonFile,
} from '@humanlayer/session-sdk-base'

import { bindingsDir, client, daemonSession, isDisabled, login } from './config.ts'
import { updateControl } from './control.ts'
import { alive, type Binding, Mirror, type MirrorHost } from './mirror.ts'
import { type LiveProcess, liveDir } from './plugin.ts'

async function pickOrg(orgs: OrgChoice[], current: OrgChoice | undefined): Promise<OrgChoice | undefined> {
	orgs.forEach((org, i) => {
		console.log(`  ${i + 1}. ${org.organizationName}${org === current ? ' (current)' : ''}`)
	})
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	try {
		const answer = (await rl.question('Organization number: ')).trim()
		if (!answer) return current ?? orgs[0]
		return orgs[Number.parseInt(answer, 10) - 1]
	} finally {
		rl.close()
	}
}

/** Codex threads open now (in cwd, if given), from the server processes' live files. */
async function openThreads(cwd?: string): Promise<string[]> {
	const out: string[] = []
	for (const name of await readdir(liveDir()).catch(() => [])) {
		const live = await readJsonFile<LiveProcess>(join(liveDir(), name))
		if (live && (!cwd || live.cwd === cwd) && alive(live.pid)) out.push(...live.threads)
	}
	return out
}

/** The saved links in cwd, newest first. */
async function links(channel: Channel, cwd: string): Promise<Binding[]> {
	const out: Binding[] = []
	for (const name of await readdir(bindingsDir(channel)).catch(() => [])) {
		const b = await readJsonFile<Binding>(join(bindingsDir(channel), name))
		if (b?.cwd === cwd) out.push(b)
	}
	return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name)
	if (i < 0) return undefined
	const value = args[i + 1]
	args.splice(i, 2)
	return value
}

/** The thread an attach, off or on acts on: --thread, else the one open here. */
async function target(args: string[], cwd: string): Promise<string | undefined> {
	const named = flag(args, '--thread')
	if (named) return named
	const open = await openThreads(cwd)
	if (open.length > 1)
		throw new Error(
			`${open.length} Codex sessions are open in this folder. Name one with --thread: ${open.join(', ')}`,
		)
	return open[0]
}

async function status(channel: Channel, cwd: string): Promise<void> {
	const who = await client.identity(channel)
	if (!who) console.log(`Not signed in to HumanLayer (${channel}). Run \`humanlayer-codex login\`.`)
	else if (who.source === 'pat') console.log(`Using HUMANLAYER_PAT (${channel}).`)
	else console.log(`Signed in to HumanLayer (${channel}) as ${who.email}, org ${who.orgName}.`)
	const open = new Set(await openThreads(cwd))
	for (const b of await links(channel, cwd)) {
		const state = b.off ? 'off' : open.has(b.threadId) ? 'open' : 'closed'
		const task = b.taskSlug ?? b.taskId
		console.log(`  ${b.threadId}  ${state}  task ${task}  ${b.sessionUrl ?? ''}`)
		open.delete(b.threadId)
	}
	for (const id of open) console.log(`  ${id}  open  not linked yet: the next prompt links it`)
}

/**
 * The SessionEnd hook. Codex stops the thread's server (SIGTERM, then a kill some 300 ms later)
 * before it runs this, and waits up to 3 s for it: this process sends what the server could not.
 * It waits for the server to go, then reads the rollout from the offset the cloud took, ends a run
 * still going as interrupted, and sends, for up to 2.3 s.
 */
async function sessionEnd(): Promise<void> {
	let input = ''
	for await (const chunk of process.stdin) input += String(chunk)
	const threadId = (JSON.parse(input || '{}') as { session_id?: unknown }).session_id
	if (typeof threadId !== 'string' || daemonSession() || isDisabled()) return console.log('{}')
	const end = Date.now() + 500
	while (Date.now() < end && (await openThreads()).includes(threadId)) await new Promise((r) => setTimeout(r, 50))
	const channel = await client.resolveChannel()
	const who = await client.identity(channel)
	const host: MirrorHost = {
		notify: () => {},
		bound: () => {},
		deliver: () => Promise.reject(new Error('Codex is exiting')),
	}
	const m = who ? await Mirror.resume(host, threadId, who, { open: false }) : undefined
	m?.settle()
	await m?.shutdown(2300)
	console.log('{}')
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const command = args.shift() ?? 'status'
	const cwd = process.cwd()

	if (command === 'login' || command === 'logout') {
		const arg = args[0]
		if (arg !== undefined && !isChannel(arg))
			throw new Error(`unknown channel "${arg}": use ${ALL_CHANNELS.join(', ')}`)
		const channel: Channel = arg ?? (await client.resolveChannel())
		if (command === 'logout') {
			await login.logout(channel)
			return console.log(`Signed out of HumanLayer (${channel}).`)
		}
		// The login waits on unref'd timers, so something must hold the process open meanwhile.
		const hold = setInterval(() => {}, 60_000)
		const creds = await login
			.startDeviceLogin(channel, {
				hasUI: process.stdin.isTTY === true,
				showCode: (url, code) => console.log(`Open ${url}\nand check the code is ${code}.`),
				pickOrg,
			})
			.finally(() => clearInterval(hold))
		if (!creds) return console.log('Login cancelled.')
		console.log(`Signed in to HumanLayer (${channel}) as ${creds.email}, org ${creds.orgName}.`)
		console.log('Codex sessions open now pick the login up at their next prompt.')
		return
	}

	const channel = await client.resolveChannel()
	if (command === 'status') return status(channel, cwd)

	if (command === 'attach') {
		const thread = await target(args, cwd)
		const task = args[0]?.trim()
		if (!task) throw new Error('attach needs a task id, a slug, or new')
		const what = task === 'new' ? 'a new task' : `task ${task}`
		if (!thread) {
			await updateControl((c) => {
				c.nextAttach = { target: task, cwd, at: new Date().toISOString() }
			})
			return console.log(`The next new Codex session in this folder starts in ${what}.`)
		}
		await updateControl((c) => {
			c.threads = { ...c.threads, [thread]: { attach: task, at: new Date().toISOString() } }
		})
		return console.log(`Codex session ${thread}: the next prompt starts a HumanLayer session in ${what}.`)
	}

	if (command === 'off' || command === 'on') {
		const thread = (await target(args, cwd)) ?? (await links(channel, cwd))[0]?.threadId
		if (!thread) throw new Error('no Codex session in this folder')
		const off = command === 'off'
		await updateControl((c) => {
			c.threads = { ...c.threads, [thread]: { off, at: new Date().toISOString() } }
		})
		return console.log(`Codex session ${thread}: mirroring ${off ? 'off' : 'on'}.`)
	}

	if (command === 'session-end') return sessionEnd()

	if (command === 'open') {
		const b = (await links(channel, cwd))[0]
		if (!b?.cloudSessionId) throw new Error('no linked Codex session in this folder')
		return console.log(`${getChannelConfig(channel).app}/sessions/${b.cloudSessionId}`)
	}

	throw new Error(`unknown command "${command}": use login, logout, status, attach, off, on or open`)
}

main().catch((err) => {
	console.error(`humanlayer-codex: ${errorMessage(err)}`)
	process.exit(1)
})
