import { describe, it, expect } from 'vitest'
import {
	parseClaudeTools,
	transformCommandFile,
	transformAgentFile,
	transformSettings,
	generateAgentsMd,
	needsPlatformGuidance,
	generatePlatformGuidance,
} from './transform.js'
import os from 'os'

const EOL = os.EOL

describe('transform.ts', () => {
	describe('parseClaudeTools', () => {
		it('should parse comma-separated tool names', () => {
			const result = parseClaudeTools('Grep, Glob, LS')
			expect(result).toEqual({
				grep: true,
				glob: true,
				list: true,
			})
		})

		it('should handle single tool', () => {
			const result = parseClaudeTools('Read')
			expect(result).toEqual({
				read: true,
			})
		})

		it('should handle all supported tools', () => {
			const result = parseClaudeTools('Grep, Glob, LS, Read, Write, Edit, Bash, Task, TodoWrite, TodoRead')
			expect(result).toEqual({
				grep: true,
				glob: true,
				list: true,
				read: true,
				write: true,
				edit: true,
				bash: true,
				task: true,
				todowrite: true,
				todoread: true,
			})
		})

		it('should handle whitespace', () => {
			const result = parseClaudeTools('  Grep  ,  Glob  ,  LS  ')
			expect(result).toEqual({
				grep: true,
				glob: true,
				list: true,
			})
		})

		it('should handle unknown tools by lowercasing them', () => {
			const result = parseClaudeTools('CustomTool, AnotherTool')
			expect(result).toEqual({
				customtool: true,
				anothertool: true,
			})
		})
	})

	describe('needsPlatformGuidance', () => {
		it('should return true for agents with grep tool', () => {
			expect(needsPlatformGuidance({ grep: true }, 'some content')).toBe(true)
		})

		it('should return true for agents with glob tool', () => {
			expect(needsPlatformGuidance({ glob: true }, 'some content')).toBe(true)
		})

		it('should return true for agents with list tool', () => {
			expect(needsPlatformGuidance({ list: true }, 'some content')).toBe(true)
		})

		it('should return true when body contains thoughts/ reference', () => {
			expect(needsPlatformGuidance(undefined, 'Check thoughts/shared/research')).toBe(true)
		})

		it('should return true when body contains codebase reference', () => {
			expect(needsPlatformGuidance(undefined, 'Search the codebase for examples')).toBe(true)
		})

		it('should return true when body mentions directories', () => {
			expect(needsPlatformGuidance(undefined, 'Check all directories in the project')).toBe(true)
			expect(needsPlatformGuidance(undefined, 'List the directory contents')).toBe(true)
		})

		it('should return true when body mentions file paths', () => {
			expect(needsPlatformGuidance(undefined, 'Provide the file path to the document')).toBe(true)
		})

		it('should return true when body references codebase agents', () => {
			expect(needsPlatformGuidance(undefined, 'Use @codebase-locator to find files')).toBe(true)
			expect(needsPlatformGuidance(undefined, 'Use @thoughts-locator agent')).toBe(true)
			expect(needsPlatformGuidance(undefined, 'Invoke @codebase-analyzer')).toBe(true)
			expect(needsPlatformGuidance(undefined, 'Use @codebase-pattern-finder')).toBe(true)
		})

		it('should return false when no platform guidance is needed', () => {
			expect(needsPlatformGuidance({ read: true, write: true }, 'Simple content without paths')).toBe(false)
		})

		it('should return false for undefined tools and simple content', () => {
			expect(needsPlatformGuidance(undefined, 'Simple task description')).toBe(false)
		})
	})

	describe('generatePlatformGuidance', () => {
		it('should generate platform guidance text', () => {
			const guidance = generatePlatformGuidance()

			expect(guidance).toContain('## Platform Compatibility')
			expect(guidance).toContain('grep')
			expect(guidance).toContain('glob')
			expect(guidance).toContain('list')
			expect(guidance).toContain('forward slashes')
			expect(guidance).toContain('cross-platform')
		})

		it('should end with proper line endings', () => {
			const guidance = generatePlatformGuidance()
			expect(guidance).toMatch(/\n$/)
		})
	})

	describe('transformCommandFile', () => {
		it('should transform frontmatter', () => {
			const input = `---
description: Test command
---

Command content here`

			const result = transformCommandFile(input)

			expect(result).toContain('description: Test command')
			expect(result).toContain('Command content here')
		})

		it('should handle missing frontmatter', () => {
			const input = 'Just plain content'
			const result = transformCommandFile(input)

			expect(result).toContain('description: Custom command')
			expect(result).toContain('Just plain content')
		})

		it('should transform SlashCommand() syntax', () => {
			const input = `---
description: Test
---

use SlashCommand() to call /research_codebase`

			const result = transformCommandFile(input)
			expect(result).toContain('use /research_codebase')
			expect(result).not.toContain('SlashCommand()')
		})

		it('should transform humanlayer launch commands', () => {
			const input = `---
description: Test
---

launch a new session with \`npx humanlayer launch --ticket ENG-123\``

			const result = transformCommandFile(input)
			expect(result).toContain('OpenCode')
			expect(result).not.toContain('launch a new session with')
		})

		it('should inject platform guidance for commands with path references', () => {
			const input = `---
description: Research command
---

Use @codebase-locator to find files in the codebase.
Check thoughts/shared/research for documentation.`

			const result = transformCommandFile(input)

			expect(result).toContain('## Platform Compatibility')
			expect(result).toContain('grep')
			expect(result).toContain('Use @codebase-locator')
			expect(result).toContain('thoughts/shared/research')
		})

		it('should not inject platform guidance for simple commands', () => {
			const input = `---
description: Simple command
---

Just do something simple without paths.`

			const result = transformCommandFile(input)

			expect(result).not.toContain('## Platform Compatibility')
			expect(result).toContain('Just do something simple')
		})

		it('should handle Windows line endings', () => {
			const input = `---\r\ndescription: Test\r\n---\r\n\r\nContent`
			const result = transformCommandFile(input)

			expect(result).toContain('description: Test')
			expect(result).toContain('Content')
		})
	})

	describe('transformAgentFile', () => {
		it('should transform agent frontmatter', () => {
			const input = `---
name: test-agent
description: Test agent
tools: Grep, Glob, LS
---

Agent body content`

			const result = transformAgentFile(input)

			expect(result).toContain('description: Test agent')
			expect(result).toContain('mode: subagent')
			expect(result).toContain('tools:')
			expect(result).toContain('  grep: true')
			expect(result).toContain('  glob: true')
			expect(result).toContain('  list: true')
			expect(result).not.toContain('name:')
			expect(result).not.toContain('model:')
			expect(result).toContain('Agent body content')
		})

		it('should inject platform guidance for agents with filesystem tools', () => {
			const input = `---
name: codebase-locator
description: Locate files in codebase
tools: Grep, Glob, LS
---

Search the codebase for relevant files.`

			const result = transformAgentFile(input)

			expect(result).toContain('## Platform Compatibility')
			expect(result).toContain('grep')
			expect(result).toContain('glob')
			expect(result).toContain('list')
			expect(result).toContain('Search the codebase')
		})

		it('should not inject platform guidance for agents without filesystem tools', () => {
			const input = `---
name: simple-agent
description: Simple agent
tools: Read, Write
---

Just read and write files.`

			const result = transformAgentFile(input)

			expect(result).not.toContain('## Platform Compatibility')
			expect(result).toContain('Just read and write files')
		})

		it('should inject platform guidance when body references paths', () => {
			const input = `---
name: thoughts-agent
description: Analyze thoughts
tools: Read
---

Check thoughts/shared/research directory for documentation.`

			const result = transformAgentFile(input)

			expect(result).toContain('## Platform Compatibility')
			expect(result).toContain('thoughts/shared/research')
		})

		it('should handle missing tools field', () => {
			const input = `---
name: no-tools
description: Agent without tools
---

Content without tools`

			const result = transformAgentFile(input)

			expect(result).toContain('description: Agent without tools')
			expect(result).toContain('mode: subagent')
			expect(result).not.toContain('tools:')
			expect(result).toContain('Content without tools')
		})

		it('should handle missing frontmatter', () => {
			const input = 'Just content without frontmatter'
			const result = transformAgentFile(input)

			expect(result).toBe(input)
		})

		it('should use default description when missing', () => {
			const input = `---
name: test
tools: Grep
---

Content`

			const result = transformAgentFile(input)
			expect(result).toContain('description: Specialized agent')
		})

		it('should handle Windows line endings', () => {
			const input = `---\r\nname: test\r\ndescription: Test\r\ntools: Grep\r\n---\r\n\r\nContent`
			const result = transformAgentFile(input)

			expect(result).toContain('description: Test')
			expect(result).toContain('Content')
		})
	})

	describe('transformSettings', () => {
		it('should transform basic settings', () => {
			const settings = {}

			const result = transformSettings(settings)

			expect(result.$schema).toBe('https://opencode.ai/config.json')
			expect(result.model).toBeUndefined()
			expect(result.instructions).toEqual(['AGENTS.md'])
		})

		it('should transform bash permissions', () => {
			const settings = {
				permissions: {
					allow: ['Bash(./hack/spec_metadata.sh)', 'Bash(./hack/create_worktree.sh)'],
				},
			}

			const result = transformSettings(settings)

			expect(result.permission).toBeDefined()
			expect(result.permission.bash).toEqual({
				'./hack/spec_metadata.sh': 'allow',
				'./hack/create_worktree.sh': 'allow',
				'*': 'ask',
			})
		})

		it('should handle settings without permissions', () => {
			const settings = {}

			const result = transformSettings(settings)
			expect(result.permission).toBeUndefined()
		})
	})

	describe('generateAgentsMd', () => {
		it('should generate AGENTS.md content', () => {
			const result = generateAgentsMd('/path/to/my-project')

			expect(result).toContain('# my-project - OpenCode Configuration')
			expect(result).toContain('Project Overview')
			expect(result).toContain('Custom Commands')
			expect(result).toContain('/create_plan')
			expect(result).toContain('@codebase-locator')
			expect(result).toContain('Code Conventions')
		})

		it('should use basename of project path', () => {
			const result = generateAgentsMd('C:\\Users\\test\\projects\\awesome-app')
			expect(result).toContain('# awesome-app - OpenCode Configuration')
		})

		it('should handle Unix paths', () => {
			const result = generateAgentsMd('/home/user/projects/cool-project')
			expect(result).toContain('# cool-project - OpenCode Configuration')
		})
	})

	describe('cross-platform line ending handling', () => {
		it('should use platform EOL in transformCommandFile', () => {
			const input = `---
description: Test
---

Content`

			const result = transformCommandFile(input)

			// Check that output uses system EOL
			expect(result.split(EOL).length).toBeGreaterThan(1)
		})

		it('should use platform EOL in transformAgentFile', () => {
			const input = `---
name: test
description: Test
tools: Grep
---

Content`

			const result = transformAgentFile(input)

			// Check that output uses system EOL
			expect(result.split(EOL).length).toBeGreaterThan(1)
		})
	})
})
