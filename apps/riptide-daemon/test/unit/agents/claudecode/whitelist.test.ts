import { describe, expect, test } from 'vitest'

import {
	getCommand,
	getFilePath,
	isArtifactPath,
	isWhitelisted,
	isWhitelistedBashCommand,
} from '../../../../src/agents/claudecode/whitelist'

describe('getFilePath', () => {
	test('extracts file_path from valid input', () => {
		expect(getFilePath({ file_path: '/path/to/file.ts' })).toBe('/path/to/file.ts')
	})

	test('returns undefined for missing file_path', () => {
		expect(getFilePath({ other: 'value' })).toBeUndefined()
	})

	test('returns undefined for non-object input', () => {
		expect(getFilePath('string')).toBeUndefined()
		expect(getFilePath(null)).toBeUndefined()
		expect(getFilePath(undefined)).toBeUndefined()
	})

	test('returns undefined for non-string file_path', () => {
		expect(getFilePath({ file_path: 123 })).toBeUndefined()
	})
})

describe('getCommand', () => {
	test('extracts command from valid input', () => {
		expect(getCommand({ command: 'ls -la' })).toBe('ls -la')
	})

	test('returns undefined for missing command', () => {
		expect(getCommand({ other: 'value' })).toBeUndefined()
	})

	test('returns undefined for non-object input', () => {
		expect(getCommand('string')).toBeUndefined()
		expect(getCommand(null)).toBeUndefined()
	})

	test('returns undefined for non-string command', () => {
		expect(getCommand({ command: 123 })).toBeUndefined()
	})
})

describe('isWhitelistedBashCommand', () => {
	test('whitelists exact rpi command', () => {
		expect(isWhitelistedBashCommand('rpi')).toBe(true)
	})

	test('whitelists rpi with arguments', () => {
		expect(isWhitelistedBashCommand('rpi sync')).toBe(true)
		expect(isWhitelistedBashCommand('rpi permalink rpi/tasks/foo.md')).toBe(true)
	})

	test('does not whitelist linear commands (linear uses server-side OAuth now)', () => {
		expect(isWhitelistedBashCommand('linear')).toBe(false)
		expect(isWhitelistedBashCommand('linear get-issue ENG-123')).toBe(false)
		expect(isWhitelistedBashCommand('linear list-issues')).toBe(false)
	})

	test('does not whitelist commands that start with rpi without space', () => {
		expect(isWhitelistedBashCommand('rpixyz')).toBe(false)
	})

	test('does not whitelist other commands', () => {
		expect(isWhitelistedBashCommand('rm -rf /')).toBe(false)
		expect(isWhitelistedBashCommand('ls -la')).toBe(false)
		expect(isWhitelistedBashCommand('git status')).toBe(false)
	})

	test('handles whitespace', () => {
		expect(isWhitelistedBashCommand('rpi sync  ')).toBe(true)
	})
})

describe('isArtifactPath', () => {
	const cwd = '/Users/kyle/projects/myproject'

	test('matches absolute path in rpi directory', () => {
		expect(isArtifactPath('/Users/kyle/projects/myproject/rpi/tasks/foo.md', cwd)).toBe(true)
	})

	test('matches relative path in rpi directory', () => {
		expect(isArtifactPath('rpi/tasks/foo.md', cwd)).toBe(true)
	})

	test('does not match paths outside rpi directory', () => {
		expect(isArtifactPath('/Users/kyle/projects/myproject/src/index.ts', cwd)).toBe(false)
		expect(isArtifactPath('src/index.ts', cwd)).toBe(false)
	})

	test('does not match rpi file at root (requires trailing slash)', () => {
		// The rpi/ directory itself or files that just start with "rpi" shouldn't match
		expect(isArtifactPath('/Users/kyle/projects/myproject/rpi-config.json', cwd)).toBe(false)
	})

	test('matches nested paths in rpi directory', () => {
		expect(isArtifactPath('rpi/tasks/eng-123/research.md', cwd)).toBe(true)
		expect(isArtifactPath('/Users/kyle/projects/myproject/rpi/tasks/eng-123/deep/nested/file.md', cwd)).toBe(true)
	})

	test('matches absolute path in .humanlayer/tasks directory', () => {
		expect(isArtifactPath('/Users/kyle/projects/myproject/.humanlayer/tasks/eng-123/research.md', cwd)).toBe(true)
	})

	test('matches relative path in .humanlayer/tasks directory', () => {
		expect(isArtifactPath('.humanlayer/tasks/eng-123/plan.md', cwd)).toBe(true)
	})

	test('matches path in ~/.humanlayer/riptide/artifacts directory', () => {
		const { homedir } = require('node:os')
		const homePath = homedir()
		expect(isArtifactPath(`${homePath}/.humanlayer/riptide/artifacts/some-uuid/file.md`, cwd)).toBe(true)
	})

	test('does not match .humanlayer without tasks subdirectory', () => {
		expect(isArtifactPath('/Users/kyle/projects/myproject/.humanlayer/config.json', cwd)).toBe(false)
	})
})

describe('isWhitelisted', () => {
	const cwd = '/Users/kyle/projects/myproject'

	test('whitelists Skill tool', () => {
		expect(isWhitelisted('Skill', { skill: 'commit' }, cwd)).toBe(true)
	})

	test('does not whitelist Bash with linear command (uses server-side OAuth now)', () => {
		expect(isWhitelisted('Bash', { command: 'linear get-issue ENG-123' }, cwd)).toBe(false)
	})

	test('whitelists Bash with rpi command', () => {
		expect(isWhitelisted('Bash', { command: 'rpi sync' }, cwd)).toBe(true)
	})

	test('does not whitelist Bash with other commands', () => {
		expect(isWhitelisted('Bash', { command: 'rm -rf /' }, cwd)).toBe(false)
		expect(isWhitelisted('Bash', { command: 'ls -la' }, cwd)).toBe(false)
	})

	test('whitelists Read for rpi paths', () => {
		expect(isWhitelisted('Read', { file_path: 'rpi/tasks/foo.md' }, cwd)).toBe(true)
		expect(isWhitelisted('Read', { file_path: '/Users/kyle/projects/myproject/rpi/tasks/foo.md' }, cwd)).toBe(true)
	})

	test('does not whitelist Read for non-rpi paths', () => {
		expect(isWhitelisted('Read', { file_path: 'src/index.ts' }, cwd)).toBe(false)
	})

	test('whitelists Write for rpi paths', () => {
		expect(isWhitelisted('Write', { file_path: 'rpi/tasks/foo.md' }, cwd)).toBe(true)
	})

	test('whitelists Edit for rpi paths', () => {
		expect(isWhitelisted('Edit', { file_path: 'rpi/tasks/foo.md' }, cwd)).toBe(true)
	})

	test('does not whitelist other tools', () => {
		expect(isWhitelisted('Glob', { pattern: '**/*.ts' }, cwd)).toBe(false)
		expect(isWhitelisted('Grep', { pattern: 'foo' }, cwd)).toBe(false)
		expect(isWhitelisted('Task', { prompt: 'do something' }, cwd)).toBe(false)
		expect(isWhitelisted('Agent', { prompt: 'do something' }, cwd)).toBe(false)
	})

	test('handles Bash with missing command gracefully', () => {
		expect(isWhitelisted('Bash', {}, cwd)).toBe(false)
		expect(isWhitelisted('Bash', { other: 'value' }, cwd)).toBe(false)
	})

	test('handles Read/Write/Edit with missing file_path gracefully', () => {
		expect(isWhitelisted('Read', {}, cwd)).toBe(false)
		expect(isWhitelisted('Write', { content: 'hello' }, cwd)).toBe(false)
		expect(isWhitelisted('Edit', { old_string: 'foo', new_string: 'bar' }, cwd)).toBe(false)
	})

	test('whitelists mcp__humanlayer__get_artifact_comments', () => {
		expect(isWhitelisted('mcp__humanlayer__get_artifact_comments', { artifact_filename: 'plan.md' }, cwd)).toBe(
			true,
		)
	})

	test('whitelists mcp__humanlayer__update_artifact_comments', () => {
		expect(
			isWhitelisted(
				'mcp__humanlayer__update_artifact_comments',
				{ artifact_filename: 'plan.md', comment_ids: ['abc123'], resolved: true },
				cwd,
			),
		).toBe(true)
	})

	test('whitelists mcp__humanlayer__reply_to_artifact_comment', () => {
		expect(
			isWhitelisted(
				'mcp__humanlayer__reply_to_artifact_comment',
				{ artifact_filename: 'plan.md', comment_id: 'abc123', content: 'Done' },
				cwd,
			),
		).toBe(true)
	})

	test.each(['get_diff_comments', 'reply_to_diff_comment', 'update_diff_comments'])(
		'whitelists mcp__humanlayer__%s',
		(toolName) => {
			expect(isWhitelisted(`mcp__humanlayer__${toolName}`, {}, cwd)).toBe(true)
		},
	)

	test('does not whitelist mcp__humanlayer__library_researcher', () => {
		expect(isWhitelisted('mcp__humanlayer__library_researcher', { question: 'how to use drizzle' }, cwd)).toBe(
			false,
		)
	})

	test('does not whitelist other MCP tools', () => {
		expect(isWhitelisted('mcp__other__some_tool', {}, cwd)).toBe(false)
	})
})
