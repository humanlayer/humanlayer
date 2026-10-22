import { RepositoryDiscoveryError, type DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { RepositoryDiscoveryService } from './repository-discovery.service'

const gitOutput = Effect.fn('repository_discovery.git_output')(function* (input: {
	readonly directory: string
	readonly arguments: ReadonlyArray<string>
}) {
	const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
	return yield* childProcessSpawner.string(
		ChildProcess.make('git', ['-C', input.directory, ...input.arguments], {
			env: { GIT_TERMINAL_PROMPT: '0' },
			extendEnv: true,
			stdin: 'ignore',
			stderr: 'ignore',
		}),
	)
})

const resolveDefaultSource = Effect.fn('repository_discovery.resolve_default_source')(function* (input: {
	readonly directory: string
	readonly defaultRemote: string | undefined
}) {
	if (input.defaultRemote) {
		const symbolic = yield* gitOutput({
			directory: input.directory,
			arguments: ['symbolic-ref', '--short', `refs/remotes/${input.defaultRemote}/HEAD`],
		}).pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)))
		if (symbolic) {
			const sourceRef = symbolic.trim()
			const remotePrefix = `${input.defaultRemote}/`
			return {
				defaultBranch: sourceRef.startsWith(remotePrefix) ? sourceRef.slice(remotePrefix.length) : sourceRef,
				sourceRef,
			}
		}
	}

	const currentBranch = yield* gitOutput({
		directory: input.directory,
		arguments: ['branch', '--show-current'],
	}).pipe(
		Effect.map((branch) => branch.trim()),
		Effect.catch(() => Effect.succeed('')),
	)
	return { defaultBranch: currentBranch || 'main', sourceRef: currentBranch || 'HEAD' }
})

const inspectRepository = Effect.fn('repository_discovery.inspect_repository')(function* (input: {
	readonly directory: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	return yield* Effect.gen(function* () {
		const requestedPath = pathService.resolve(input.directory)
		const [canonical, topLevel] = yield* Effect.all([
			fileSystem.realPath(requestedPath),
			gitOutput({ directory: requestedPath, arguments: ['rev-parse', '--show-toplevel'] }).pipe(
				Effect.flatMap((directory) => fileSystem.realPath(directory.trim())),
			),
		])
		if (topLevel !== canonical) return undefined

		const remotesText = yield* gitOutput({ directory: input.directory, arguments: ['remote', '-v'] }).pipe(
			Effect.catch(() => Effect.succeed('')),
		)
		const remotesByName = new Map<string, string>()
		for (const line of remotesText.split('\n')) {
			const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/u.exec(line.trim())
			if (match?.[1] && match[2]) remotesByName.set(match[1], match[2])
		}
		const defaultRemote = remotesByName.has('origin') ? 'origin' : remotesByName.keys().next().value
		const { defaultBranch, sourceRef } = yield* resolveDefaultSource({
			directory: requestedPath,
			defaultRemote,
		})
		return {
			path: requestedPath,
			name: pathService.basename(requestedPath),
			remotes: [...remotesByName].map(([name, url]) => ({ name, url })),
			defaultRemote,
			defaultBranch,
			sourceRef,
		} satisfies DiscoveredGitRepository
	}).pipe(Effect.catch(() => Effect.succeed(undefined)))
})

const isInsideRepository = Effect.fn('repository_discovery.is_inside_repository')(function* (input: {
	readonly directory: string
}) {
	return yield* gitOutput({
		directory: input.directory,
		arguments: ['rev-parse', '--is-inside-work-tree'],
	}).pipe(
		Effect.map((output) => output.trim() === 'true'),
		Effect.catch(() => Effect.succeed(false)),
	)
})

export const inspectSelectedGitRepository = Effect.fn('repository_discovery.inspect_selected')(function* (input: {
	readonly directory: string
}) {
	const pathService = yield* Path.Path
	const selectedPath = pathService.resolve(input.directory)
	const [isInsideGitRepository, selectedRepository] = yield* Effect.all([
		isInsideRepository({ directory: selectedPath }),
		inspectRepository({ directory: selectedPath }),
	])
	return { isInsideGitRepository, selectedRepository }
})

export const discoverGitRepositories = Effect.fn('repository_discovery.discover')(function* (input: {
	readonly directory: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const selectedPath = pathService.resolve(input.directory)
	const selectedRepository = yield* inspectRepository({ directory: selectedPath })
	if (selectedRepository) return [selectedRepository]

	const entries = yield* fileSystem
		.readDirectory(selectedPath)
		.pipe(Effect.mapError((cause) => new RepositoryDiscoveryError({ message: String(cause) })))
	const repositories = yield* Effect.forEach(
		entries,
		(entry) => inspectRepository({ directory: pathService.join(selectedPath, entry) }),
		{ concurrency: 'unbounded' },
	)
	return repositories.flatMap((repository) => (repository ? [repository] : []))
})

export const RepositoryDiscoveryServiceLive = Layer.succeed(
	RepositoryDiscoveryService,
	RepositoryDiscoveryService.of({
		discover: discoverGitRepositories,
		inspectSelected: inspectSelectedGitRepository,
	}),
)
