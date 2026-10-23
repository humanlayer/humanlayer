import { access, chmod, link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { Option, Schema } from 'effect'

const DockerConfig = Schema.Record(Schema.String, Schema.Unknown)
const DockerCliPluginDirectories = Schema.Array(Schema.String)

function dockerCliPluginsDirectory(): string {
	return join(homedir(), '.docker', 'cli-plugins')
}

function withDockerCliPlugins(config: unknown) {
	const parsed = Schema.decodeUnknownOption(DockerConfig)(config)
	const configuredDirectories = Option.getOrElse(
		Option.flatMap(parsed, (dockerConfig) =>
			Schema.decodeUnknownOption(DockerCliPluginDirectories)(dockerConfig.cliPluginsExtraDirs),
		),
		(): ReadonlyArray<string> => [],
	)
	const pluginsDirectory = dockerCliPluginsDirectory()
	const cliPluginsExtraDirs = configuredDirectories.includes(pluginsDirectory)
		? configuredDirectories
		: [...configuredDirectories, pluginsDirectory]
	return Option.match(parsed, {
		onNone: () => ({ cliPluginsExtraDirs }),
		onSome: (dockerConfig) => ({ ...dockerConfig, cliPluginsExtraDirs }),
	})
}

function serializeDockerConfig(config: unknown): string {
	return `${JSON.stringify(withDockerCliPlugins(config), null, 2)}\n`
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined
}

export function devstackDockerConfigDirectory(registryPath: string): string {
	return join(dirname(registryPath), 'docker-config')
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		(error: unknown) => {
			if (errorCode(error) === 'ENOENT') return false
			throw error
		},
	)
}

export async function ensureDevstackDockerConfig(registryPath: string): Promise<string> {
	const directory = devstackDockerConfigDirectory(registryPath)
	const configPath = join(directory, 'config.json')
	await mkdir(directory, { recursive: true, mode: 0o700 })
	await chmod(directory, 0o700)

	if (await pathExists(configPath)) {
		const metadata = await lstat(configPath)
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error(`Devstack Docker config must be a regular file: ${configPath}`)
		}
		const currentConfig: unknown = JSON.parse(await readFile(configPath, 'utf8'))
		const nextConfig = serializeDockerConfig(currentConfig)
		const temporaryPath = `${configPath}.${process.pid}.${crypto.randomUUID()}.tmp`
		await writeFile(temporaryPath, nextConfig, { mode: 0o600, flag: 'wx' })
		await rename(temporaryPath, configPath)
		await chmod(configPath, 0o600)
		return directory
	}

	const temporaryPath = `${configPath}.${process.pid}.${crypto.randomUUID()}.tmp`
	try {
		await writeFile(temporaryPath, serializeDockerConfig({ auths: {} }), { mode: 0o600, flag: 'wx' })
		try {
			await link(temporaryPath, configPath)
		} catch (error) {
			if (errorCode(error) !== 'EEXIST') throw error
		}
		const metadata = await lstat(configPath)
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error(`Devstack Docker config must be a regular file: ${configPath}`)
		}
		await chmod(configPath, 0o600)
	} finally {
		await rm(temporaryPath, { force: true })
	}

	return directory
}

export async function createDevstackDockerProcessEnvironment(registryPath: string) {
	return createDockerProcessEnvironment({ registryPath, initializeConfig: true })
}

export async function createDockerProcessEnvironment(input: {
	readonly registryPath: string
	readonly initializeConfig: boolean
}) {
	const environment: { DOCKER_CONFIG: string; DOCKER_HOST?: string } = {
		DOCKER_CONFIG: input.initializeConfig
			? await ensureDevstackDockerConfig(input.registryPath)
			: devstackDockerConfigDirectory(input.registryPath),
	}
	if (process.env.DOCKER_HOST) {
		environment.DOCKER_HOST = process.env.DOCKER_HOST
		return environment
	}
	if (process.platform !== 'darwin') return environment

	const dockerDesktopSocket = join(homedir(), '.docker', 'run', 'docker.sock')
	if (await pathExists(dockerDesktopSocket)) {
		environment.DOCKER_HOST = `unix://${dockerDesktopSocket}`
	}
	return environment
}
