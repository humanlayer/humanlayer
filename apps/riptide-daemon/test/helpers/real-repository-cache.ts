import { NodeServices } from '@effect/platform-node'
import { ConfigProvider, Effect, FileSystem, Layer, Path } from 'effect'

import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunnerLive, GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'
import { RepositorySourceResolverLive } from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'

export const RealRepositoryTestPlatform = Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
	Layer.provideMerge(NodeServices.layer),
)

export const makeRealRepositoryCacheFixture = Effect.fn('test.make_real_repository_cache_fixture')(function* () {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitCommandRunner
	const root = yield* fs.makeTempDirectoryScoped({ prefix: 'repository-source-' })
	const home = path.join(root, 'home')
	const cacheRoot = path.join(root, 'cache')
	const remote = path.join(root, 'remote.git')
	const source = path.join(root, 'source')
	yield* fs.makeDirectory(home)
	const run = (argv: ReadonlyArray<string>, cwd = root) => git.run(argv, { cwd, env: { HOME: home } })
	yield* run(['init', '--bare', '--initial-branch=main', remote])
	yield* run(['init', '--initial-branch=main', source])
	yield* run(['config', 'user.name', 'Repository Test'], source)
	yield* run(['config', 'user.email', 'repository-test@example.test'], source)
	yield* fs.writeFileString(path.join(source, 'README.md'), 'fixture\n')
	yield* run(['add', 'README.md'], source)
	yield* run(['commit', '-m', 'fixture'], source)
	yield* run(['remote', 'add', 'origin', remote], source)
	yield* run(['push', 'origin', 'main'], source)
	const commit = (yield* run(['rev-parse', 'HEAD'], source)).stdout.trim()
	const identities = [
		'github.com/acme/repo',
		'github.com/Acme/repo',
		'github.com/~41cme/repo',
		'gitlab.com/acme/repo',
		'gitlab.com/group/nested/repo',
		'github.com/other/repo',
		'git.example/team/repo',
		'git.example/team/repo/subrepo',
		'git.example/team/repo/.repository',
		'git.example/team/repo/~2erepository',
	]
	yield* fs.writeFileString(
		path.join(home, '.gitconfig'),
		`[url "${remote}"]\n${identities
			.flatMap((identity) => {
				const slash = identity.indexOf('/')
				return [
					`\tinsteadOf = https://${identity}.git`,
					`\tinsteadOf = git@${identity.slice(0, slash)}:${identity.slice(slash + 1)}.git`,
				]
			})
			.join('\n')}\n`,
	)
	const config = (configuredRoot = cacheRoot) =>
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ HOME: home, RIPTIDE_MANAGED_REPOSITORY_ROOT: configuredRoot }),
		)
	const cacheLayer = (configuredRoot = cacheRoot) =>
		Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
			Layer.provideMerge(
				Layer.mergeAll(RealRepositoryTestPlatform, config(configuredRoot), RepositorySourceResolverLive),
			),
		)
	return { root, home, cacheRoot, remote, source, commit, config, cacheLayer, run }
})

interface IsolatedRepositoryUserFixtureInput {
	readonly root: string
	readonly remote: string
	readonly name: string
}

/**
 * Models one application user's daemon environment: its own home, Git config,
 * managed cache root, and workspace root. Two of these against one shared bare
 * remote reproduce two users on one host (or two hosts) who share only what was
 * published to the remote.
 */
export const makeIsolatedRepositoryUserFixture = Effect.fn('test.make_isolated_repository_user_fixture')(function* (
	input: IsolatedRepositoryUserFixtureInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitCommandRunner
	const userRoot = path.join(input.root, 'users', input.name)
	const home = path.join(userRoot, 'home')
	const cacheRoot = path.join(userRoot, 'cache')
	const workspaceRoot = path.join(userRoot, 'workspaces')
	yield* fs.makeDirectory(home, { recursive: true })
	yield* fs.makeDirectory(workspaceRoot, { recursive: true })
	yield* fs.writeFileString(
		path.join(home, '.gitconfig'),
		[
			`[url "${input.remote}"]`,
			'\tinsteadOf = https://github.com/acme/repo.git',
			'\tinsteadOf = git@github.com:acme/repo.git',
			'[user]',
			`\tname = ${input.name}`,
			`\temail = ${input.name}@example.test`,
			'',
		].join('\n'),
	)
	const run = (argv: ReadonlyArray<string>, cwd = userRoot) => git.run(argv, { cwd, env: { HOME: home } })
	const config = () =>
		ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: home, RIPTIDE_MANAGED_REPOSITORY_ROOT: cacheRoot }))
	const cacheLayer = () =>
		Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
			Layer.provideMerge(Layer.mergeAll(RealRepositoryTestPlatform, config(), RepositorySourceResolverLive)),
		)
	return { name: input.name, home, cacheRoot, workspaceRoot, config, cacheLayer, run }
})
