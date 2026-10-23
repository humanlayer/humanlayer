// Standalone runner for the mock cloud, for e2e in tmux (plan.md §9): `bun run mock-cloud`.
// Port: first CLI arg, else MOCK_CLOUD_PORT, else 8799 (plan.md's e2e default). The diff streams
// (HUMANLAYER_SYNC_URL) listen on the next port. `--orgs N` (MOCK_CLOUD_ORGS) puts the user in N
// orgs; `--pending N` (MOCK_CLOUD_PENDING_POLLS) holds each device login for N polls.

import { parseArgs } from 'node:util'

import { MOCK_PAT, startMockCloud } from '../helpers/mock-cloud.ts'
import { startMockStreams } from '../helpers/mock-streams.ts'

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { orgs: { type: 'string' }, pending: { type: 'string' } },
})

function count(name: string, value: string | undefined, fallback: number): number {
	const n = Number(value ?? fallback)
	if (value?.trim() === '' || !Number.isSafeInteger(n) || n < 0)
		throw new Error(`Invalid mock cloud ${name}: ${value}`)
	return n
}

const port = count('port', positionals[0] ?? process.env.MOCK_CLOUD_PORT, 8799)
if (positionals.length > 1 || port > 65534)
	throw new Error('Expected one port from 0 to 65534 (diff streams use the next port)')
const orgs = count('--orgs', values.orgs ?? process.env.MOCK_CLOUD_ORGS, 1)
const pendingPolls = count('--pending', values.pending ?? process.env.MOCK_CLOUD_PENDING_POLLS, 0)

const cloud = await startMockCloud(port, { orgs, pendingPolls })
const streams = await startMockStreams({ port: port === 0 ? 0 : port + 1 })
console.error(`HumanLayer mock cloud listening on ${cloud.url}`)
console.error(`Diff streams (for HUMANLAYER_SYNC_URL) on ${streams.url}`)
for (const org of cloud.state.orgs) console.error(`Organization: ${org.organizationName} (${org.organizationId})`)
console.error(`User: ${cloud.state.email}`)
console.error(`Device logins: approved after ${pendingPolls} pending polls`)
console.error(`PAT (for HUMANLAYER_PAT): ${MOCK_PAT}`)
console.error(
	'Control: GET /__mock/state, POST /__mock/config {orgs?, pendingPolls?}, POST /__mock/fail {route, status?, code?, data?, network?, hang?, times?}, POST /__mock/reset',
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		Promise.allSettled([cloud.close(), streams.close()]).finally(() => process.exit(0))
	})
}
