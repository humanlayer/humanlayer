/**
 * Type definitions for tool inputs used by Claude Code
 * Based on actual tool usage found in the codebase
 */

// File system tools
export interface LSToolInput {
  path: string
  ignore?: string[]
}

export interface ReadToolInput {
  file_path: string
  limit?: number
  offset?: number
}

export interface GlobToolInput {
  pattern: string
  path?: string
}

export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
}

export interface EditToolInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface MultiEditToolInput {
  file_path: string
  edits: Array<{
    old_string: string
    new_string: string
    replace_all?: boolean
  }>
}

export interface WriteToolInput {
  file_path: string
  content: string
}

export interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  head_limit?: number
  multiline?: boolean
  '-A'?: number
  '-B'?: number
  '-C'?: number
  '-i'?: boolean
  '-n'?: boolean
}

// Task management tools
export interface TaskToolInput {
  description: string
  // Additional fields may exist
}

export interface TodoWriteToolInput {
  todos: Array<{
    id: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    priority: 'high' | 'medium' | 'low'
  }>
}

// Web tools
export interface WebSearchToolInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export interface WebFetchToolInput {
  url: string
  prompt: string
}

// Linear integration tools (MCP)
export interface LinearGetIssueToolInput {
  id: string
}

export interface LinearListIssuesToolInput {
  assigneeId?: string
  createdAt?: string
  cycleId?: string
  delegateId?: string
  includeArchived?: boolean
  limit?: number
  parentId?: string
  projectId?: string
  query?: string
  stateId?: string
  teamId?: string
  updatedAt?: string
}

export interface LinearCreateIssueToolInput {
  title: string
  teamId: string
  description?: string
  assigneeId?: string
  cycleId?: string
  delegateId?: string
  dueDate?: string
  labelIds?: string[]
  links?: Array<{
    url: string
    title: string
  }>
  parentId?: string
  priority?: number
  projectId?: string
  stateId?: string
}

export interface LinearUpdateIssueToolInput {
  id: string
  title?: string
  description?: string
  assigneeId?: string
  cycleId?: string
  delegateId?: string
  dueDate?: string
  estimate?: number
  labelIds?: string[]
  links?: Array<{
    url: string
    title: string
  }>
  parentId?: string
  priority?: number
  projectId?: string
  stateId?: string
}

// Notebook tools
export interface NotebookReadToolInput {
  notebook_path: string
  cell_id?: string
}

export interface NotebookEditToolInput {
  notebook_path: string
  new_source: string
  cell_id?: string
  cell_type?: 'code' | 'markdown'
  edit_mode?: 'replace' | 'insert' | 'delete'
}

// System tools
export interface ExitPlanModeToolInput {
  plan: string
}

// Map of tool names to their input types
export interface ToolInputMap {
  // File system tools
  LS: LSToolInput
  Read: ReadToolInput
  Glob: GlobToolInput
  Bash: BashToolInput
  Edit: EditToolInput
  MultiEdit: MultiEditToolInput
  Write: WriteToolInput
  Grep: GrepToolInput

  // Task management
  Task: TaskToolInput
  TodoWrite: TodoWriteToolInput

  // Web tools
  WebSearch: WebSearchToolInput
  WebFetch: WebFetchToolInput

  // Linear tools (MCP)
  mcp__linear__get_issue: LinearGetIssueToolInput
  mcp__linear__list_issues: LinearListIssuesToolInput
  mcp__linear__create_issue: LinearCreateIssueToolInput
  mcp__linear__update_issue: LinearUpdateIssueToolInput

  // Notebook tools
  NotebookRead: NotebookReadToolInput
  NotebookEdit: NotebookEditToolInput

  // System tools
  ExitPlanMode: ExitPlanModeToolInput
}

// Type helper to get tool input type from tool name
export type ToolInput<T extends keyof ToolInputMap> = ToolInputMap[T]

// Union type of all tool inputs
export type AnyToolInput = ToolInputMap[keyof ToolInputMap]

// Type guard to check if a tool name is valid
export function isValidToolName(name: string): name is keyof ToolInputMap {
  const validTools: (keyof ToolInputMap)[] = [
    'LS',
    'Read',
    'Glob',
    'Bash',
    'Edit',
    'MultiEdit',
    'Write',
    'Grep',
    'Task',
    'TodoWrite',
    'WebSearch',
    'WebFetch',
    'mcp__linear__get_issue',
    'mcp__linear__list_issues',
    'mcp__linear__create_issue',
    'mcp__linear__update_issue',
    'NotebookRead',
    'NotebookEdit',
    'ExitPlanMode',
  ]
  return validTools.includes(name as keyof ToolInputMap)
}
