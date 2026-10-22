#!/usr/bin/env node
// The plugin's MCP server, as Codex starts it from .mcp.json: one process per Codex thread, over
// stdio. At exit Codex closes stdin and sends SIGTERM, and kills the server about 300 ms later, so
// SIGTERM saves state and makes a last short try. Then Codex runs the SessionEnd hook, whose own
// process (cli.ts session-end) sends what is left.

import { log } from './config.ts'
import { serveMcp } from './mcp.ts'
import { createPlugin } from './plugin.ts'

const plugin = createPlugin()
let exiting: Promise<void> | undefined

/** What SIGTERM leaves time for. */
const LAST_TRY_MS = 200

const exit = () => {
	exiting ??= plugin
		.shutdown(LAST_TRY_MS)
		.catch(() => {})
		.finally(() => process.exit(0))
}

const server = serveMcp({ tools: plugin.tools, call: plugin.call, closed: exit })
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
	process.on(signal, () => {
		log(`${signal}`)
		server.stop()
		exit()
	})
void plugin.start()
