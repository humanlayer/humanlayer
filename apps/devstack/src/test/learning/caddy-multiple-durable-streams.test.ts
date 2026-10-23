import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const hasCaddy = await execFileAsync('caddy', ['version']).then(
	() => true,
	() => false,
)

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.unref()
		server.on('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			if (address === null || typeof address === 'string') {
				server.close(() => reject(new Error('Unable to allocate a TCP port')))
				return
			}
			const { port } = address
			server.close(() => resolve(port))
		})
	})
}

async function createStreamingServer(name: string): Promise<{ port: number; server: HttpServer }> {
	const server = createHttpServer((_request, response) => {
		response.writeHead(200, {
			'cache-control': 'no-cache',
			'content-type': 'text/plain',
			'x-backend-stream': name,
		})
		response.write(`${name}:chunk-1\n`)
		setTimeout(() => {
			response.write(`${name}:chunk-2\n`)
			response.end()
		}, 25)
	})

	await new Promise<void>((resolve, reject) => {
		server.on('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})

	const address = server.address()
	if (address === null || typeof address === 'string') {
		throw new Error('Streaming server did not bind to a TCP port')
	}

	return { port: address.port, server }
}

async function waitForCaddy(port: number, host: string): Promise<void> {
	const startedAt = Date.now()
	let lastError: unknown

	while (Date.now() - startedAt < 5_000) {
		try {
			const response = await fetch(`http://${host}:${port}/health`)
			if (response.ok) return
		} catch (error) {
			lastError = error
		}

		await new Promise((resolve) => setTimeout(resolve, 50))
	}

	throw new Error(`Timed out waiting for Caddy. Last error: ${String(lastError)}`)
}

describe.skipIf(Boolean(process.env.CI) || !hasCaddy)('Caddy multi-stack durable-stream routing learning test', () => {
	let caddyProcess: ChildProcess | null = null
	let tempDir: string | null = null
	const servers: HttpServer[] = []

	afterEach(async () => {
		caddyProcess?.kill()
		caddyProcess = null
		await Promise.all(
			servers.splice(0).map(
				(server) =>
					new Promise<void>((resolve, reject) => {
						server.close((error) => (error ? reject(error) : resolve()))
					}),
			),
		)
		if (tempDir) await rm(tempDir, { force: true, recursive: true })
		tempDir = null
	})

	it('routes two stack-scoped streaming backends through one Caddy listener by host', async () => {
		const alpha = await createStreamingServer('alpha')
		const beta = await createStreamingServer('beta')
		servers.push(alpha.server, beta.server)

		const caddyPort = await getFreePort()
		tempDir = await mkdtemp(join(tmpdir(), 'devstack-caddy-learning-'))
		const caddyfilePath = join(tempDir, 'Caddyfile')

		await writeFile(
			caddyfilePath,
			`
{
	admin off
	auto_https off
	log {
		level WARN
	}
}

http://streams-alpha.localhost:${caddyPort} {
	reverse_proxy 127.0.0.1:${alpha.port} {
		flush_interval -1
	}
	header {
		Cache-Control "no-cache, no-transform"
		X-Accel-Buffering "no"
	}
}

http://streams-beta.localhost:${caddyPort} {
	reverse_proxy 127.0.0.1:${beta.port} {
		flush_interval -1
	}
	header {
		Cache-Control "no-cache, no-transform"
		X-Accel-Buffering "no"
	}
}
`,
		)

		caddyProcess = spawn('caddy', ['run', '--config', caddyfilePath], { stdio: 'pipe' })

		await waitForCaddy(caddyPort, 'streams-alpha.localhost')

		const [alphaResponse, betaResponse] = await Promise.all([
			fetch(`http://streams-alpha.localhost:${caddyPort}/streams`),
			fetch(`http://streams-beta.localhost:${caddyPort}/streams`),
		])

		expect(alphaResponse.status).toBe(200)
		expect(betaResponse.status).toBe(200)
		await expect(alphaResponse.text()).resolves.toBe('alpha:chunk-1\nalpha:chunk-2\n')
		await expect(betaResponse.text()).resolves.toBe('beta:chunk-1\nbeta:chunk-2\n')
	})
})
