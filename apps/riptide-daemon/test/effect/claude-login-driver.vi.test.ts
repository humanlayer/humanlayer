import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { makeClaudeLoginDriver } from '@/effects/services/provider-login/drivers/claude-login-driver'
import type {
	ProviderLoginDriverContext,
	ProviderLoginPatch,
} from '@/effects/services/provider-login/provider-login.types'

// Stands in for `claude`: prints the sign-in link on stdout, rejects an incomplete code on
// stderr the way the real CLI does, exits 1 on a well-formed but wrong code, and answers
// `auth status` with the account JSON.
const FAKE_CLAUDE = `#!/usr/bin/env bash
if [ "$1 $2" = "auth status" ]; then
  echo '{"email":"dev@example.com","subscriptionType":"max"}'
  exit 0
fi
echo "Opening browser to sign in…"
echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc"
printf 'Paste code here if prompted > '
while read -r code; do
  case "$code" in
    good#state) exit 0 ;;
    *#*) echo "Login failed: Request failed with status code 400" >&2; exit 1 ;;
    *) echo "Invalid code. Please make sure the full code was copied." >&2 ;;
  esac
done
exit 1
`

let scriptPath: string
let dir: string

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'fake-claude-'))
	scriptPath = join(dir, 'claude')
	await writeFile(scriptPath, FAKE_CLAUDE)
	await chmod(scriptPath, 0o755)
})

afterAll(async () => {
	await rm(dir, { recursive: true, force: true })
})

function makeContext() {
	const patches: ProviderLoginPatch[] = []
	const waiters: Array<(patch: ProviderLoginPatch) => void> = []
	const abort = new AbortController()
	const context: ProviderLoginDriverContext = {
		requestId: 'req-1',
		provider: 'claude',
		signal: abort.signal,
		update: async (patch) => {
			patches.push(patch)
			for (const resolve of waiters.splice(0)) resolve(patch)
		},
	}
	const nextPatch = () => new Promise<ProviderLoginPatch>((resolve) => waiters.push(resolve))
	return { context, patches, nextPatch, abort }
}

const makeDriver = () =>
	makeClaudeLoginDriver({ executable: scriptPath, prefixArguments: [], env: { PATH: process.env.PATH ?? '' } })

describe('makeClaudeLoginDriver against a fake claude CLI', () => {
	it('announces the link, flags an incomplete code printed on stderr, and accepts the next one', async () => {
		const driver = makeDriver()
		const { context, patches, nextPatch } = makeContext()

		const awaiting = nextPatch()
		const result = driver.start(context)
		expect(await awaiting).toMatchObject({ status: 'awaiting_approval', url: expect.stringContaining('authorize') })

		const rejected = nextPatch()
		driver.submitCode?.('abc')
		expect(await rejected).toEqual({
			error: 'Could not sign in to Claude. The code was incomplete. Copy the full code and try again.',
			clearSubmittedCode: true,
		})

		driver.submitCode?.('good#state')
		expect(await result).toEqual({ accountLabel: 'Signed in as dev@example.com · max plan' })
		expect(patches.filter((patch) => patch.error)).toHaveLength(1)
	})

	it('reports a rejected code plainly when the CLI exits after it', async () => {
		const driver = makeDriver()
		const { context, nextPatch } = makeContext()

		const awaiting = nextPatch()
		const result = driver.start(context)
		await awaiting

		driver.submitCode?.('wrong#state')
		await expect(result).rejects.toMatchObject({
			message: 'Could not sign in to Claude. The code was not accepted. Start again and paste a new code.',
		})
	})
})
