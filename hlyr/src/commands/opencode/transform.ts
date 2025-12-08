import path from 'path'
import os from 'os'

export type ModelType = 'haiku' | 'sonnet' | 'opus'

// Use platform-specific line ending
const EOL = os.EOL

/**
 * Transform short model names to full Anthropic model names
 */
export function transformModelName(model: string | undefined): string {
  if (!model) return 'anthropic/claude-opus-4'

  const modelMap: Record<string, string> = {
    opus: 'anthropic/claude-opus-4',
    sonnet: 'anthropic/claude-sonnet-4-5',
    haiku: 'anthropic/claude-haiku-4-5',
  }

  // Return mapped value or pass through if already a full name
  return modelMap[model] || model
}

/**
 * Parse Claude tools string (comma-separated) to OpenCode tools object
 */
export function parseClaudeTools(toolsString: string): Record<string, boolean> {
  const tools: Record<string, boolean> = {}

  const toolMap: Record<string, string> = {
    Grep: 'grep',
    Glob: 'glob',
    LS: 'list',
    Read: 'read',
    Write: 'write',
    Edit: 'edit',
    Bash: 'bash',
    Task: 'task',
    TodoWrite: 'todowrite',
    TodoRead: 'todoread',
  }

  const parts = toolsString.split(',').map(s => s.trim())

  for (const part of parts) {
    const normalizedName = toolMap[part] || part.toLowerCase()
    tools[normalizedName] = true
  }

  return tools
}

/**
 * Transform command file from Claude format to OpenCode format
 */
export function transformCommandFile(content: string): string {
  // Parse frontmatter and body
  // Handle both \n and \r\n line endings
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    // No frontmatter - treat entire content as template
    return `---${EOL}description: Custom command${EOL}---${EOL}${EOL}${content}`
  }

  const [, frontmatter, body] = frontmatterMatch
  const lines = frontmatter.split(/\r?\n/)
  const fm: Record<string, any> = {}

  // Parse YAML frontmatter
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/)
    if (match) {
      fm[match[1]] = match[2]
    }
  }

  // Transform body content
  let transformedContent = body.trim()

  // Transform: SlashCommand() calls -> just the command
  // Example: "use SlashCommand() to call /ralph_research" -> "use /ralph_research"
  transformedContent = transformedContent.replace(
    /use SlashCommand\(\) to call (\/[\w_-]+)/g,
    'use $1',
  )

  // Transform: npx humanlayer launch commands -> OpenCode equivalent
  // These commands don't make sense in OpenCode (commands run in same session)
  transformedContent = transformedContent.replace(
    /launch a new session with `npx humanlayer launch[^`]+`/g,
    '(Note: In OpenCode, commands run in the same session - no need to launch separate sessions)',
  )

  transformedContent = transformedContent.replace(/humanlayer launch[^\n]+/g, match => {
    // Keep on separate line with note
    return '(OpenCode note: This workflow is specific to Claude Code - adapt as needed for OpenCode)'
  })

  // Transform: Task() pseudo-code examples -> @agent syntax
  transformedContent = transformedContent.replace(/Task\("([^"]+)",\s*([^)]+)\)/g, (match, desc) => {
    return `@subagent with prompt: "${desc}"`
  })

  // Build new frontmatter
  let newFrontmatter = `---${EOL}`
  newFrontmatter += `description: ${fm.description || 'Custom command'}${EOL}`
  if (fm.model) {
    newFrontmatter += `model: ${transformModelName(fm.model)}${EOL}`
  }
  if (fm.agent) {
    newFrontmatter += `agent: ${fm.agent}${EOL}`
  }
  if (fm.subtask !== undefined) {
    newFrontmatter += `subtask: ${fm.subtask}${EOL}`
  }
  newFrontmatter += `---${EOL}${EOL}`

  return newFrontmatter + transformedContent
}

/**
 * Transform agent file from Claude format to OpenCode format
 */
export function transformAgentFile(content: string): string {
  // Handle both \n and \r\n line endings
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    return content // Return as-is if no frontmatter
  }

  const [, frontmatter, body] = frontmatterMatch
  const lines = frontmatter.split(/\r?\n/)
  const fm: Record<string, any> = {}

  // Parse YAML frontmatter
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/)
    if (match) {
      fm[match[1]] = match[2]
    }
  }

  // Build OpenCode frontmatter
  let newFrontmatter = `---${EOL}`

  // description (required)
  newFrontmatter += `description: ${fm.description || 'Specialized agent'}${EOL}`

  // mode (all agents in .claude are subagents)
  newFrontmatter += `mode: subagent${EOL}`

  // model (transform short names)
  if (fm.model) {
    newFrontmatter += `model: ${transformModelName(fm.model)}${EOL}`
  }

  // tools (transform from string to object)
  if (fm.tools) {
    const toolsObj = parseClaudeTools(fm.tools)
    newFrontmatter += `tools:${EOL}`
    for (const [tool, enabled] of Object.entries(toolsObj)) {
      newFrontmatter += `  ${tool}: ${enabled}${EOL}`
    }
  }

  // Note: We remove 'name' field - filename becomes the agent name in OpenCode

  newFrontmatter += `---${EOL}${EOL}`

  return newFrontmatter + body.trim()
}

/**
 * Transform Claude settings.json to OpenCode opencode.json
 */
export function transformSettings(
  settings: any,
  options: { model?: ModelType },
): Record<string, any> {
  const config: Record<string, any> = {
    $schema: 'https://opencode.ai/config.json',
  }

  // Transform model
  config.model = transformModelName(options.model || settings.model || 'opus')

  // Transform permissions from Claude format to OpenCode format
  if (settings.permissions?.allow) {
    config.permission = {}

    // Parse Claude permissions
    const bashPermissions: Record<string, string> = {}

    for (const perm of settings.permissions.allow) {
      // Example: "Bash(./hack/spec_metadata.sh)" -> bash permission
      const bashMatch = perm.match(/^Bash\((.+)\)$/)
      if (bashMatch) {
        bashPermissions[bashMatch[1]] = 'allow'
      }
    }

    if (Object.keys(bashPermissions).length > 0) {
      config.permission.bash = {
        ...bashPermissions,
        '*': 'ask', // Default to asking for other commands
      }
    }
  }

  // Add instructions reference (for AGENTS.md if created)
  config.instructions = ['AGENTS.md']

  // Drop Claude-specific settings that don't apply to OpenCode:
  // - enableAllProjectMcpServers (OpenCode handles MCP differently)
  // - env.MAX_THINKING_TOKENS (thinking mode is Claude-specific)
  // - env.CLAUDE_BASH_MAINTAIN_WORKING_DIR (Claude-specific)
  // - alwaysThinkingEnabled (Claude-specific)

  return config
}

/**
 * Generate AGENTS.md template for a project
 */
export function generateAgentsMd(projectPath: string): string {
  const projectName = path.basename(projectPath)

  return `# ${projectName} - OpenCode Configuration

This file contains custom instructions for OpenCode when working in this project.

## Project Overview

[Add project description here]

## Custom Commands

This project includes HumanLayer workflow commands and agents initialized via \`humanlayer opencode init\`.

Available in \`.opencode/command/\`:
- Planning workflows (\`/create_plan\`, \`/implement_plan\`)
- Code analysis (\`/research_codebase\`)
- CI/CD helpers (\`/commit\`, \`/describe_pr\`)
- And many more - see \`.opencode/command/\` for full list

Available agents in \`.opencode/agent/\`:
- \`@codebase-locator\` - Find files and components
- \`@codebase-analyzer\` - Analyze code structure
- \`@thoughts-analyzer\` - Process developer notes
- And more - see \`.opencode/agent/\` for full list

## Code Conventions

[Add project-specific conventions here]

## Important Notes

[Add any critical information here]
`
}
