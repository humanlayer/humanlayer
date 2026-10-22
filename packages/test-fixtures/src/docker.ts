import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

export const ELECTRIC_IMAGE = 'docker.io/electricsql/electric:1.7.12'
export const POSTGRES_IMAGE = 'docker.io/postgres:18'

type CommandResult = {
	exitCode: number
	stdout: string
	stderr: string
}

/**
 * Run a command without a shell, capturing stdout/stderr.
 * Never throws on non-zero exit — callers inspect `exitCode` (the old `$.nothrow()` semantics).
 */
function run(cmd: string, args: string[]): Promise<CommandResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString()
		})
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString()
		})
		child.on('error', (error) => {
			resolve({ exitCode: 1, stdout, stderr: stderr || error.message })
		})
		child.on('close', (exitCode) => {
			resolve({ exitCode: exitCode ?? 1, stdout, stderr })
		})
	})
}

async function createNetwork(networkName: string) {
	const result = await run('docker', ['network', 'create', networkName])
	const output = result.stdout + result.stderr
	if (result.exitCode !== 0 && !output.includes('already exists')) {
		throw new Error(`Failed to create network: ${output}`)
	}
	return networkName
}

async function removeNetwork(networkName: string) {
	await run('docker', ['network', 'rm', networkName])
}

async function startPostgres18Container(opts: {
	password: string
	port: number
	networkName: string
	containerName: string
}): Promise<{ containerId: string; port: number }> {
	const portsToTry = [opts.port, opts.port + 100, opts.port + 200, opts.port + 300, opts.port + 400]

	let lastError: Error | null = null

	for (const tryPort of portsToTry) {
		const result = await run('docker', [
			'run',
			'-d',
			'--rm',
			'--network',
			opts.networkName,
			'--name',
			opts.containerName,
			'-e',
			'POSTGRES_DB=electric',
			'-e',
			'POSTGRES_USER=postgres',
			'-e',
			`POSTGRES_PASSWORD=${opts.password}`,
			'-p',
			`127.0.0.1:${tryPort}:5432`,
			POSTGRES_IMAGE,
			'-c',
			'listen_addresses=*',
			'-c',
			'wal_level=logical',
		])

		if (result.exitCode !== 0) {
			const stderr = result.stderr
			if (stderr.includes('port is already allocated') || stderr.includes('address already in use')) {
				lastError = new Error(`Port ${tryPort} already in use`)
				continue
			}
			throw new Error(
				`Unable to start docker! Docker process exited with code ${result.exitCode} (${result.stdout || result.stderr})`,
			)
		}

		const containerId = result.stdout.trim()
		console.log(`[DOCKER] Postgres container started: ${containerId} (name: ${opts.containerName})`)

		for (let i = 0; i < 30; i++) {
			const ready = await run('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres'])
			if (ready.exitCode === 0) {
				await sleep(500)
				return { containerId, port: tryPort }
			}
			await sleep(500)
		}

		await run('docker', ['stop', containerId])
		await run('docker', ['rm', containerId])
		lastError = new Error(`Postgres on port ${tryPort} failed to become ready in time`)
	}

	throw lastError ?? new Error('Failed to start Postgres container after trying multiple ports')
}

async function startElectricContainer(opts: {
	postgres: { port: number; password: string }
	electric: { port: number; secret: string }
	networkName: string
	postgresContainerName: string
}): Promise<{ containerId: string; port: number }> {
	const portsToTry = [
		opts.electric.port,
		opts.electric.port + 100,
		opts.electric.port + 200,
		opts.electric.port + 300,
		opts.electric.port + 400,
	]

	let lastError: Error | null = null
	const baseContainerName = `electric-${opts.postgresContainerName.replace('postgres-', '')}`

	for (const tryPort of portsToTry) {
		for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
			const electricContainerName =
				retryAttempt === 0 ? baseContainerName : `${baseContainerName}-r${retryAttempt}`

			const result = await run('docker', [
				'run',
				'-d',
				'--rm',
				'--name',
				electricContainerName,
				'--network',
				opts.networkName,
				'-e',
				`DATABASE_URL=postgresql://postgres:${opts.postgres.password}@${opts.postgresContainerName}:5432/electric?sslmode=disable`,
				'-e',
				`ELECTRIC_SECRET=${opts.electric.secret}`,
				'-p',
				`127.0.0.1:${tryPort}:3000`,
				ELECTRIC_IMAGE,
			])

			if (result.exitCode !== 0) {
				const stderr = result.stderr
				const stdout = result.stdout
				if (stderr.includes('port is already allocated') || stderr.includes('address already in use')) {
					lastError = new Error(`Port ${tryPort} already in use`)
					break
				}
				if (stderr.includes('is already in use') || stdout.includes('is already in use')) {
					await run('docker', ['rm', '-f', electricContainerName])
					lastError = new Error(`Container name ${electricContainerName} was in use, removed and retrying`)
					continue
				}
				console.error(
					`Electric container attempt ${retryAttempt + 1} failed with exit code ${result.exitCode}:`,
					stdout || stderr,
				)
				lastError = new Error(`Electric container failed: exit code ${result.exitCode}`)
				await sleep(1000 * (retryAttempt + 1))
				continue
			}

			const containerId = result.stdout.trim()
			console.log(`[DOCKER] Electric container started: ${containerId} (name: ${electricContainerName})`)

			try {
				await waitForElectricReady(tryPort, containerId)
				return { containerId, port: tryPort }
			} catch (e) {
				await run('docker', ['stop', containerId])
				await run('docker', ['rm', containerId])
				lastError = e as Error
				break
			}
		}
	}

	throw lastError ?? new Error('Failed to start Electric container after trying multiple ports')
}

async function waitForElectricReady(port: number, containerId: string, timeout = 30_000) {
	const start = Date.now()
	let lastError: Error | null = null

	while (Date.now() - start < timeout) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/v1/health`)
			if (res.status === 200 || res.status === 202) {
				return true
			}
		} catch (e) {
			lastError = e as Error
		}
		await sleep(500)
	}

	const logs = await run('docker', ['logs', containerId, '--tail', '50'])
	console.error('Electric container logs:', logs.stdout + logs.stderr)

	throw new Error(
		`Electric failed to become ready within ${timeout}ms. Last error: ${lastError?.message ?? 'unknown'}`,
	)
}

async function shutdownContainer(containerId: string) {
	const result = await run('docker', ['stop', containerId])
	if (result.exitCode !== 0)
		throw new Error(`Failed to stop docker: ${result.exitCode} (${result.stdout || result.stderr})`)
	return result.stdout
}

export async function startContainers(opts: {
	postgres: { password: string; port: number }
	electric: { secret: string; port: number }
}): Promise<{
	postgresContainerId: string
	electricContainerId: string
	networkName: string
	postgresPort: number
	electricPort: number
}> {
	const suffix = Math.random().toString(36).substring(2, 8)
	const networkName = `test-network-${suffix}`
	const postgresContainerName = `postgres-test-${suffix}`

	await createNetwork(networkName)
	const postgres = await startPostgres18Container({
		...opts.postgres,
		networkName,
		containerName: postgresContainerName,
	})
	const electric = await startElectricContainer({
		postgres: { port: postgres.port, password: opts.postgres.password },
		electric: opts.electric,
		networkName,
		postgresContainerName,
	})
	return {
		postgresContainerId: postgres.containerId,
		electricContainerId: electric.containerId,
		networkName,
		postgresPort: postgres.port,
		electricPort: electric.port,
	}
}

const KEEP_CONTAINERS_FOR_DEBUG = false

export async function shutdownContainers(opts: {
	postgresContainerId: string
	electricContainerId: string
	networkName: string
}) {
	if (KEEP_CONTAINERS_FOR_DEBUG) {
		console.log(`[DOCKER] Keeping containers for debugging:`)
		console.log(`  Electric: docker logs ${opts.electricContainerId}`)
		console.log(`  Postgres: docker logs ${opts.postgresContainerId}`)
		console.log(
			`  Cleanup: docker rm -f ${opts.electricContainerId} ${opts.postgresContainerId} && docker network rm ${opts.networkName}`,
		)
		return
	}
	await shutdownContainer(opts.electricContainerId)
	await shutdownContainer(opts.postgresContainerId)
	await removeNetwork(opts.networkName)
}
