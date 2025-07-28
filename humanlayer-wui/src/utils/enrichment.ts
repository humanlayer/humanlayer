import { Approval } from '@/lib/daemon'

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
    icon: getFunctionIcon(approval.toolName),
    color: getFunctionColor(approval.toolName),
    title: approval.toolName,
    description: getToolDescription(approval.toolName, approval.toolInput),
    fields: extractFieldsFromToolInput(approval.toolName, approval.toolInput),
  }

  return baseData
}

// Add helper to extract fields from tool input
function extractFieldsFromToolInput(toolName: string, toolInput: any): ApprovalField[] {
  const fields: ApprovalField[] = []

  if (!toolInput) return fields

  // Tool-specific field extraction
  switch (toolName.toLowerCase()) {
    case 'bash':
      if (toolInput.command) {
        fields.push({
          label: 'Command',
          value: toolInput.command,
          truncate: true,
        })
      }
      break

    case 'edit':
    case 'write':
      if (toolInput.path || toolInput.file_path) {
        fields.push({
          label: 'File',
          value: toolInput.path || toolInput.file_path,
          isPath: true,
        })
      }
      break

    case 'http':
    case 'fetch':
      if (toolInput.url) {
        fields.push({
          label: 'URL',
          value: toolInput.url,
          truncate: true,
        })
      }
      if (toolInput.method) {
        fields.push({
          label: 'Method',
          value: toolInput.method,
        })
      }
      break

    default:
      // Generic field extraction for unknown tools
      Object.entries(toolInput).forEach(([key, value]) => {
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

function getToolDescription(toolName: string, toolInput: any): string {
  switch (toolName.toLowerCase()) {
    case 'bash':
      return `Execute command: ${toolInput.command || 'unknown'}`
    case 'edit':
      return `Edit file: ${toolInput.path || toolInput.file_path || 'unknown'}`
    case 'write':
      return `Write to file: ${toolInput.path || toolInput.file_path || 'unknown'}`
    case 'http':
    case 'fetch':
      return `${toolInput.method || 'GET'} request to ${toolInput.url || 'unknown'}`
    case 'read':
      return `Read file: ${toolInput.path || toolInput.file_path || 'unknown'}`
    case 'list':
      return `List directory: ${toolInput.path || toolInput.directory || '.'}`
    default:
      return `Execute ${toolName} with provided parameters`
  }
}
