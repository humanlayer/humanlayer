import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { loadFoldCompatibility } from '@/effects/services/fold-sessions/fold-compatibility-selection'

it.effect('loads Codex instructions from home through cwd with override and local behavior', () =>
	Effect.acquireUseRelease(
		Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'fold-codex-compatibility-'))),
		(root) =>
			Effect.gen(function* () {
				const home = join(root, 'home')
				const codexHome = join(home, '.codex')
				const workspace = join(home, 'workspace')
				const cwd = join(workspace, 'repo')
				yield* Effect.tryPromise(() =>
					Promise.all([mkdir(codexHome, { recursive: true }), mkdir(cwd, { recursive: true })]),
				)
				yield* Effect.tryPromise(() =>
					Promise.all([
						writeFile(join(home, 'AGENTS.md'), 'home base'),
						writeFile(join(home, 'AGENTS.local.md'), 'home local'),
						writeFile(join(workspace, 'AGENTS.md'), 'workspace base loser'),
						writeFile(join(workspace, 'AGENTS.override.md'), 'workspace override'),
						writeFile(join(workspace, 'AGENTS.local.md'), 'workspace local loser'),
						writeFile(join(cwd, 'AGENTS.local.md'), 'cwd local'),
						writeFile(join(codexHome, 'AGENTS.md'), 'global codex'),
					]),
				)

				const compatibility = yield* loadFoldCompatibility({
					provider: 'codex',
					model: 'gpt-5.3-codex',
					workingDirectory: cwd,
					homeDirectory: home,
					codexHome,
				})
				const block = compatibility.instructionBlock ?? ''

				expect(block).toContain('global codex')
				expect(block).toContain('home base')
				expect(block).toContain('home local')
				expect(block).toContain('workspace override')
				expect(block).toContain('cwd local')
				expect(block).not.toContain('workspace base loser')
				expect(block).not.toContain('workspace local loser')
				expect(block.indexOf('home base')).toBeLessThan(block.indexOf('cwd local'))
			}),
		(root) => Effect.tryPromise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
	).pipe(Effect.provide(NodeServices.layer)),
)

it.effect('loads Grok rules and compatible context without loading Codex-only context', () =>
	Effect.acquireUseRelease(
		Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'fold-grok-compatibility-'))),
		(root) =>
			Effect.gen(function* () {
				const home = join(root, 'home')
				const grokHome = join(home, '.grok')
				const repo = join(root, 'repo')
				const cwd = join(repo, 'apps')
				yield* Effect.tryPromise(() =>
					Promise.all([
						mkdir(join(repo, '.git'), { recursive: true }),
						mkdir(join(grokHome, 'rules'), { recursive: true }),
						mkdir(join(home, '.codex'), { recursive: true }),
						mkdir(join(repo, '.grok', 'rules'), { recursive: true }),
						mkdir(join(repo, '.claude', 'rules'), { recursive: true }),
						mkdir(cwd, { recursive: true }),
					]),
				)
				yield* Effect.tryPromise(() =>
					Promise.all([
						writeFile(join(grokHome, 'AGENTS.md'), 'global grok'),
						writeFile(join(grokHome, 'rules', 'style.md'), '---\nglobs: src/**\n---\nglobal grok rule'),
						writeFile(join(home, '.codex', 'AGENTS.md'), 'codex only'),
						writeFile(join(repo, 'AGENTS.md'), 'repo agents'),
						writeFile(join(repo, '.gitignore'), '.grok/rules/ignored.md\n'),
						writeFile(join(repo, '.grok', 'rules', 'safety.md'), 'repo grok rule'),
						writeFile(join(repo, '.grok', 'rules', 'ignored.md'), 'ignored grok rule'),
						writeFile(join(repo, '.claude', 'rules', 'compat.md'), 'repo claude rule'),
						writeFile(join(cwd, 'CLAUDE.md'), 'cwd claude'),
					]),
				)

				const compatibility = yield* loadFoldCompatibility({
					provider: 'xai',
					model: 'grok-4.6',
					workingDirectory: cwd,
					homeDirectory: home,
					grokHome,
				})
				const block = compatibility.instructionBlock ?? ''

				expect(block).toContain('global grok')
				expect(block).toContain('global grok rule')
				expect(block).toContain('repo agents')
				expect(block).toContain('repo grok rule')
				expect(block).not.toContain('ignored grok rule')
				expect(block).toContain('repo claude rule')
				expect(block).toContain('cwd claude')
				expect(block).not.toContain('codex only')
				expect(compatibility.projectRoot.replace(/^\/private/, '')).toBe(repo.replace(/^\/private/, ''))
			}),
		(root) => Effect.tryPromise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
	).pipe(Effect.provide(NodeServices.layer)),
)
