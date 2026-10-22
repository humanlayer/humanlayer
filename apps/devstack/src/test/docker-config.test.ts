import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
	createDevstackDockerProcessEnvironment,
	devstackDockerConfigDirectory,
	ensureDevstackDockerConfig,
} from '../lib/docker-config'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function createRegistryPath(): string {
	const stateRoot = join(tmpdir(), `devstack-docker-config-${crypto.randomUUID()}`)
	temporaryDirectories.push(stateRoot)
	return join(stateRoot, 'default.json')
}

describe.skipIf(Boolean(process.env.CI))('devstack Docker configuration', () => {
	it('initializes a credential-free Docker config for a new machine', async () => {
		const registryPath = createRegistryPath()
		const directory = await ensureDevstackDockerConfig(registryPath)
		const configPath = join(directory, 'config.json')

		expect(directory).toBe(devstackDockerConfigDirectory(registryPath))
		expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
			auths: {},
			cliPluginsExtraDirs: [join(homedir(), '.docker', 'cli-plugins')],
		})
		expect((await lstat(directory)).mode & 0o777).toBe(0o700)
		expect((await lstat(configPath)).mode & 0o777).toBe(0o600)
	})

	it('preserves an existing devstack-scoped login', async () => {
		const registryPath = createRegistryPath()
		const directory = devstackDockerConfigDirectory(registryPath)
		const configPath = join(directory, 'config.json')
		const existingConfig = '{"auths":{"registry.example.com":{"auth":"token"}}}\n'
		await mkdir(directory, { recursive: true })
		await writeFile(configPath, existingConfig)

		await ensureDevstackDockerConfig(registryPath)

		expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
			auths: { 'registry.example.com': { auth: 'token' } },
			cliPluginsExtraDirs: [join(homedir(), '.docker', 'cli-plugins')],
		})
		expect((await lstat(configPath)).mode & 0o777).toBe(0o600)
	})

	it('initializes safely when multiple setup processes start together', async () => {
		const registryPath = createRegistryPath()
		const directories = await Promise.all(Array.from({ length: 8 }, () => ensureDevstackDockerConfig(registryPath)))

		expect(new Set(directories).size).toBe(1)
		expect(JSON.parse(await readFile(join(directories[0]!, 'config.json'), 'utf8'))).toEqual({
			auths: {},
			cliPluginsExtraDirs: [join(homedir(), '.docker', 'cli-plugins')],
		})
	})

	it('provides the isolated config to Docker subprocesses', async () => {
		const registryPath = createRegistryPath()
		const environment = await createDevstackDockerProcessEnvironment(registryPath)
		const dockerConfig = environment.DOCKER_CONFIG
		if (!dockerConfig) throw new Error('Expected DOCKER_CONFIG to be configured')

		expect(dockerConfig).toBe(devstackDockerConfigDirectory(registryPath))
		expect(JSON.parse(await readFile(join(dockerConfig, 'config.json'), 'utf8'))).toEqual({
			auths: {},
			cliPluginsExtraDirs: [join(homedir(), '.docker', 'cli-plugins')],
		})
	})
})
