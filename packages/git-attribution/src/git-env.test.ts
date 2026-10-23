import { describe, expect, it } from 'vitest'

import { attributionGitConfigEntries, shellQuoteHookCommand, toGitHookPath } from './git-env'

describe('toGitHookPath (path-shape gated, never platform-sniffed)', () => {
	it('converts Windows drive-letter and UNC paths to forward slashes', () => {
		expect(toGitHookPath('C:\\Users\\First Last\\.humanlayer\\riptide\\git-hooks')).toBe(
			'C:/Users/First Last/.humanlayer/riptide/git-hooks',
		)
		expect(toGitHookPath('c:/already/forward')).toBe('c:/already/forward')
		expect(toGitHookPath('\\\\server\\share\\dir')).toBe('//server/share/dir')
	})

	it('leaves POSIX paths untouched — even ones containing literal backslashes', () => {
		expect(toGitHookPath('/home/dev/.humanlayer/riptide/git-hooks')).toBe('/home/dev/.humanlayer/riptide/git-hooks')
		expect(toGitHookPath('/home/we\\ird/dir')).toBe('/home/we\\ird/dir')
	})
})

describe('shellQuoteHookCommand', () => {
	it('quotes spaces and neutralizes shell metacharacters totally', () => {
		expect(shellQuoteHookCommand('/a b/c')).toBe("'/a b/c'")
		expect(shellQuoteHookCommand('/p/$(rm -rf ~)/`x`/&&;|')).toBe("'/p/$(rm -rf ~)/`x`/&&;|'")
	})

	it("escapes embedded single quotes with the standard '\\'' dance", () => {
		expect(shellQuoteHookCommand("/it's/a path")).toBe("'/it'\\''s/a path'")
	})
})

describe('attributionGitConfigEntries', () => {
	it('hooks-path mode: one exclusive core.hooksPath entry', () => {
		expect(attributionGitConfigEntries({ mode: 'hooks-path', hooksDir: '/s/git-hooks', baseEnv: {} })).toEqual({
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.hooksPath',
			GIT_CONFIG_VALUE_0: '/s/git-hooks',
		})
	})

	it('config-hooks mode: additive event+command entries, command quoted, path normalized', () => {
		const entries = attributionGitConfigEntries({
			mode: 'config-hooks',
			hooksDir: 'C:\\Users\\First Last\\.humanlayer\\riptide\\git-hooks',
			baseEnv: {},
		})
		expect(entries).toEqual({
			GIT_CONFIG_COUNT: '2',
			GIT_CONFIG_KEY_0: 'hook.humanlayer-attribution.event',
			GIT_CONFIG_VALUE_0: 'prepare-commit-msg',
			GIT_CONFIG_KEY_1: 'hook.humanlayer-attribution.command',
			// stamp-commit-msg: the chain-free entry — git 2.54+ runs the repo's hookdir hook
			// natively after configured hooks, so the config command must not chain it itself.
			GIT_CONFIG_VALUE_1: "'C:/Users/First Last/.humanlayer/riptide/git-hooks/stamp-commit-msg'",
		})
	})

	it('APPENDS after pre-existing GIT_CONFIG_* entries in both modes', () => {
		const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '/ci' }
		expect(
			attributionGitConfigEntries({ mode: 'hooks-path', hooksDir: '/s', baseEnv: base }).GIT_CONFIG_KEY_1,
		).toBe('core.hooksPath')
		const cfg = attributionGitConfigEntries({ mode: 'config-hooks', hooksDir: '/s', baseEnv: base })
		expect(cfg.GIT_CONFIG_COUNT).toBe('3')
		expect(cfg.GIT_CONFIG_KEY_1).toBe('hook.humanlayer-attribution.event')
		expect(cfg.GIT_CONFIG_KEY_2).toBe('hook.humanlayer-attribution.command')
	})

	it('a garbage pre-existing count is treated as zero, never NaN-propagated', () => {
		const entries = attributionGitConfigEntries({
			mode: 'hooks-path',
			hooksDir: '/s',
			baseEnv: { GIT_CONFIG_COUNT: 'banana' },
		})
		expect(entries.GIT_CONFIG_COUNT).toBe('1')
		expect(entries.GIT_CONFIG_KEY_0).toBe('core.hooksPath')
	})
})
