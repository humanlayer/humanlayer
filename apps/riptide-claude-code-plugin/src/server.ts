#!/usr/bin/env node
// The plugin's MCP server, which Claude Code starts with the session and stops at exit. It offers
// the model no tools: the HumanLayer tools are the mod's (named `mcp__humanlayer__*`, as daemon
// sessions have them), and the mod calls this server for them. What it does is everything that
// needs Node: sign-in, mirroring, task files, the diff and the web app's followers. The mod
// reaches it over HTTP on a Unix socket named after Claude Code's pid, this process's parent.

import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'

import { errorMessage } from '@humanlayer/session-sdk-base'

import { FLUSH_MS, log, socketPath } from './config.ts'
import { Host } from './host.ts'
import type { ApprovalAsk, CommandAsk, CommandsReport, Hello, ModEvent, ToolAsk } from './protocol.ts'

const claudePid = Number(process.env.HUMANLAYER_CLAUDE_PID) || process.ppid
const host = new Host(claudePid)
const path = socketPath(claudePid)

// ---- MCP over stdio: enough to be a server Claude Code keeps, with no tools ----

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
	input += chunk
	for (let i = input.indexOf('\n'); i >= 0; i = input.indexOf('\n')) {
		const line = input.slice(0, i).trim()
		input = input.slice(i + 1)
		if (line) answerMcp(line)
	}
})
process.stdin.on('end', () => void exit('stdin closed'))

function answerMcp(line: string): void {
	let msg: { id?: number | string; method?: string; params?: { protocolVersion?: string } }
	try {
		msg = JSON.parse(line)
	} catch {
		return
	}
	if (msg.id === undefined || !msg.method) return // a notification, or a response to nothing we asked
	const reply = (result: unknown): void =>
		void process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`)
	switch (msg.method) {
		case 'initialize':
			return reply({
				protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'humanlayer-mirror', version: '0.1.0' },
				instructions: 'Mirrors this session to HumanLayer. It has no tools of its own.',
			})
		case 'tools/list':
			return reply({ tools: [] })
		case 'ping':
			return reply({})
		default:
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } })}\n`,
			)
	}
}

// ---- the mod's API ----

async function body<T>(req: IncomingMessage): Promise<T> {
	let text = ''
	for await (const chunk of req) text += chunk
	return (text ? JSON.parse(text) : {}) as T
}

function send(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(value))
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', 'http://hl')
	switch (`${req.method} ${url.pathname}`) {
		case 'POST /hello':
			return send(res, 200, await host.hello(await body<Hello>(req)))
		case 'POST /event': {
			const e = await body<ModEvent>(req)
			await host.event(e)
			// A prompt may have linked the session: the mod adds its task folder section to it.
			return send(res, 200, e.kind === 'prompt' ? { hint: host.hint(e.sessionId) ?? null } : {})
		}
		case 'GET /actions':
			return send(res, 200, await host.takeActions(Math.min(Number(url.searchParams.get('wait')) || 0, 25_000)))
		case 'POST /approval':
			return send(res, 200, host.approval(await body<ApprovalAsk>(req)))
		case 'GET /approval':
			return send(
				res,
				200,
				await host.waitApproval(
					url.searchParams.get('id') ?? '',
					Math.min(Number(url.searchParams.get('wait')) || 0, 25_000),
				),
			)
		case 'POST /command':
			return send(res, 200, { text: await host.command((await body<CommandAsk>(req)).args) })
		case 'POST /tool':
			return send(res, 200, await host.tool(await body<ToolAsk>(req)))
		case 'POST /commands':
			await host.reportCommands(await body<CommandsReport>(req))
			return send(res, 200, {})
		case 'GET /hint':
			return send(res, 200, { text: host.hint(url.searchParams.get('sessionId') ?? '') ?? null })
		default:
			return send(res, 404, { error: 'not found' })
	}
}

const server = createServer((req, res) => {
	route(req, res).catch((err) => {
		log(`${req.method} ${req.url}: ${errorMessage(err)}`)
		if (!res.headersSent) send(res, 500, { error: errorMessage(err) })
	})
})
// A long poll waits up to 25 s; the default timeouts would cut it.
server.requestTimeout = 0
server.headersTimeout = 0

mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
rmSync(path, { force: true }) // a socket left by a process with the same pid, long gone
server.listen(path, () => {
	chmodSync(path, 0o600)
	log(`server for Claude Code ${claudePid} on ${path}`)
})

// ---- exit ----

let exiting = false
async function exit(why: string): Promise<void> {
	if (exiting) return
	exiting = true
	log(`exiting: ${why}`)
	await host.shutdown(FLUSH_MS).catch((err) => log(`shutdown: ${errorMessage(err)}`))
	server.close()
	rmSync(path, { force: true })
	process.exit(0)
}

// Claude Code sends SIGINT, then SIGTERM, then SIGKILL. The first starts the flush; a later one waits for it.
process.on('SIGINT', () => void exit('SIGINT'))
process.on('SIGTERM', () => void exit('SIGTERM'))
process.on('SIGHUP', () => void exit('SIGHUP'))

// Claude Code gone without a word (killed): its pid no longer runs, and this process is reparented.
setInterval(() => {
	if (process.ppid !== claudePid && !process.env.HUMANLAYER_CLAUDE_PID) void exit('Claude Code exited')
}, 2000).unref()
