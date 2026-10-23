import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import daemonPackage from '../../../riptide-daemon/package.json'

const execute = promisify(execFile)

describe('daemon development environment', () => {
	it('loads root origins and development credentials when launched from the package directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'daemon-dev-env-'))
		try {
			const packageDirectory = join(root, 'apps', 'riptide-daemon')
			await mkdir(join(packageDirectory, 'src'), { recursive: true })
			await writeFile(
				join(root, '.env'),
				[
					'RIPTIDE_API_ORIGIN=https://api.fixture.localhost',
					'RIPTIDE_SYNC_ORIGIN=https://sync.fixture.localhost',
					'RIPTIDE_DAEMON_LOAD_CREDS=true',
					'RIPTIDE_DAEMON_USER_ID=fixture-user',
				].join('\n'),
			)
			await writeFile(
				join(packageDirectory, 'src', 'daemon.ts'),
				`console.log(JSON.stringify([
					process.env.RIPTIDE_API_ORIGIN,
					process.env.RIPTIDE_SYNC_ORIGIN,
					process.env.RIPTIDE_DAEMON_LOAD_CREDS,
					process.env.RIPTIDE_DAEMON_USER_ID,
				]))`,
			)
			// Exercise the real launch command in a synthetic checkout, without watch's persistent process.
			const { stdout } = await execute('sh', ['-c', daemonPackage.scripts.dev.replace('--watch ', '')], {
				cwd: packageDirectory,
				env: { PATH: process.env.PATH },
				timeout: 10_000,
			})
			expect(JSON.parse(stdout.trim())).toEqual([
				'https://api.fixture.localhost',
				'https://sync.fixture.localhost',
				'true',
				'fixture-user',
			])
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
