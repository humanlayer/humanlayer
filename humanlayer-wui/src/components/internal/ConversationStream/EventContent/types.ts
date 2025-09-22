export enum ToolName {
  Bash = 'Bash',
  Task = 'Task',
  TodoWrite = 'TodoWrite',
  Read = 'Read',
  Write = 'Write',
  Edit = 'Edit',
  MultiEdit = 'MultiEdit',
  NotebookRead = 'NotebookRead',
  NotebookEdit = 'NotebookEdit',
  ExitPlanMode = 'ExitPlanMode',
  Grep = 'Grep',
  Glob = 'Glob',
  LS = 'LS',
  WebSearch = 'WebSearch',
  WebFetch = 'WebFetch',
  // Add more as needed
}

export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
  run_in_background?: boolean
}

export interface BashToolCallContentProps {
  toolInput: BashToolInput
  approvalStatus?: string
  isCompleted?: boolean
  toolResultContent?: string
  isFocused?: boolean
}

// Generic tool call content props interface
export interface ToolCallContentProps<T> {
  toolInput: T
  approvalStatus?: string
  isCompleted?: boolean
  toolResultContent?: string
  isFocused?: boolean
}

export function parseToolInput<T>(toolInputJson: string | undefined): T | null {
  if (!toolInputJson) return null
  try {
    return JSON.parse(toolInputJson) as T
  } catch {
    return null
  }
}
