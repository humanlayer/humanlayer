// The MCP server over stdio, as Codex talks to it: a tool call Codex makes for a hook names a tool
// tools/list leaves out, carries its thread in _meta, and does not wait behind another call.

import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { serveMcp } from '../src/mcp.ts'

test('tools/list shows the listed tools; a call to an unlisted one still runs, with its thread', async () => {
	const input = new PassThrough()
	const output = new PassThrough()
	const lines: Record<string, unknown>[] = []
	output.on('data', (chunk: Buffer) => {
		for (const line of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(line))
	})
	let release: () => void = () => {}
	const server = serveMcp(
		{
			tools: () => [{ name: 'listed', description: 'a tool', inputSchema: { type: 'object' } }],
			call: async (name, args, ctx) => {
				if (name === 'slow') await new Promise<void>((r) => (release = r))
				return { text: JSON.stringify({ name, args, thread: ctx.threadId }) }
			},
			closed: () => {},
		},
		{ input, output },
	)
	const send = (m: Record<string, unknown>) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
	send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
	send({ id: 2, method: 'tools/list' })
	send({ id: 3, method: 'tools/call', params: { name: 'slow', arguments: {} } })
	send({
		id: 4,
		method: 'tools/call',
		params: { name: 'codex_hook', arguments: { a: 1 }, _meta: { threadId: 't-1' } },
	})
	const byId = async (id: number) => {
		for (let i = 0; i < 200 && !lines.some((l) => l.id === id); i++) await new Promise((r) => setTimeout(r, 5))
		return lines.find((l) => l.id === id) as {
			result: { tools?: { name: string }[]; content?: { text: string }[] }
		}
	}
	assert.equal((await byId(1)).result !== undefined, true)
	assert.deepEqual(
		(await byId(2)).result.tools?.map((t) => t.name),
		['listed'],
	)
	// The slow call is still waiting; the hook's answer came anyway.
	assert.deepEqual(JSON.parse((await byId(4)).result.content?.[0]?.text ?? ''), {
		name: 'codex_hook',
		args: { a: 1 },
		thread: 't-1',
	})
	assert.equal(
		lines.some((l) => l.id === 3),
		false,
	)
	release()
	await byId(3)
	server.stop()
})
