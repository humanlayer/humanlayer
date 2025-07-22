import { Approval } from '@/lib/daemon'
import type { AnyToolInput } from '@/lib/daemon/toolTypes'

// Types for display data
export interface ApprovalField {
  label: string
  value: string
  truncate?: boolean
  isPath?: boolean
}

export interface ApprovalDisplayData {
  type: 'function' | 'human'
  icon: string
  color: string
  title: string
  description: string
  fields: ApprovalField[]
}

export function getDisplayDataForApproval(approval: Approval): ApprovalDisplayData {
  const baseData = {
    type: 'function' as const,
    icon: getFunctionIcon(approval.tool_name),
    color: getFunctionColor(approval.tool_name),
    title: approval.tool_name,
    description: getToolDescription(approval.tool_name, approval.tool_input),
    fields: extractFieldsFromToolInput(approval.tool_name, approval.tool_input),
  }

  return baseData
}

// Add helper to extract fields from tool input
function extractFieldsFromToolInput(toolName: string, toolInput: AnyToolInput): ApprovalField[] {
  const fields: ApprovalField[] = []

  if (!toolInput) return fields

  // Tool-specific field extraction
  const input = toolInput as any // Type assertion for legacy compatibility
  switch (toolName.toLowerCase()) {
    case 'bash':
      if (input.command) {
        fields.push({
          label: 'Command',
          value: input.command,
          truncate: true,
        })
      }
      break

    case 'edit':
    case 'write':
      if (input.path || input.file_path) {
        fields.push({
          label: 'File',
          value: input.path || input.file_path,
          isPath: true,
        })
      }
      break

    case 'http':
    case 'fetch':
      if (input.url) {
        fields.push({
          label: 'URL',
          value: input.url,
          truncate: true,
        })
      }
      if (input.method) {
        fields.push({
          label: 'Method',
          value: input.method,
        })
      }
      break

    default:
      // Generic field extraction for unknown tools
      Object.entries(input).forEach(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          fields.push({
            label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            value: String(value),
            truncate: true,
          })
        }
      })
  }

  return fields
}

function getFunctionIcon(toolName: string): string {
  const iconMap: Record<string, string> = {
    bash: '🖥️',
    edit: '✏️',
    write: '📝',
    http: '🌐',
    fetch: '🔍',
    read: '📖',
    list: '📋',
  }

  return iconMap[toolName.toLowerCase()] || '🔧'
}

function getFunctionColor(toolName: string): string {
  const colorMap: Record<string, string> = {
    bash: 'text-green-500',
    edit: 'text-blue-500',
    write: 'text-purple-500',
    http: 'text-orange-500',
    fetch: 'text-yellow-500',
    read: 'text-cyan-500',
    list: 'text-gray-500',
  }

  return colorMap[toolName.toLowerCase()] || 'text-gray-400'
}

function getToolDescription(toolName: string, toolInput: AnyToolInput): string {
  const input = toolInput as any // Type assertion for legacy compatibility
  switch (toolName.toLowerCase()) {
    case 'bash':
      return `Execute command: ${input.command || 'unknown'}`
    case 'edit':
      return `Edit file: ${input.path || input.file_path || 'unknown'}`
    case 'write':
      return `Write to file: ${input.path || input.file_path || 'unknown'}`
    case 'http':
    case 'fetch':
      return `${input.method || 'GET'} request to ${input.url || 'unknown'}`
    case 'read':
      return `Read file: ${input.path || input.file_path || 'unknown'}`
    case 'list':
      return `List directory: ${input.path || input.directory || '.'}`
    default:
      return `Execute ${toolName} with provided parameters`
  }
}
