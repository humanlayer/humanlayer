import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'

interface MCPToolCallParamPreviewProps {
  toolInput: any
  attributeLimit?: number
  isDim?: boolean
}

export function MCPToolCallParamPreview({
  toolInput,
  attributeLimit = 5,
  isDim = false,
}: MCPToolCallParamPreviewProps) {
  const parsedInput = toolInput

  // Handle undefined or null input
  if (parsedInput === undefined || parsedInput === null) {
    return <div className="mt-1 font-mono text-sm text-muted-foreground">{String(parsedInput)}</div>
  }

  // Helper to format value based on type
  const formatValue = (value: any): string => {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return `"${value}"`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
      const count = value.length
      if (count === 0) return '[]'
      return `[/* ...${count} ${count === 1 ? 'item' : 'items'}... */]`
    }
    if (typeof value === 'object') {
      const count = Object.keys(value).length
      if (count === 0) return '{}'
      return `{/* ...${count} ${count === 1 ? 'key' : 'keys'}... */}`
    }
    return String(value)
  }

  // Helper to format object with attribute limit
  const formatObject = (obj: Record<string, any>): string => {
    const entries = Object.entries(obj)
    const displayEntries = entries.slice(0, attributeLimit)
    const remaining = entries.length - attributeLimit

    const lines = displayEntries.map(([key, value]) => `  ${key}: ${formatValue(value)}`)

    if (remaining > 0) {
      lines.push(`  // and ${remaining} more ${remaining === 1 ? 'attribute' : 'attributes'}`)
    }

    return `{\n${lines.join(',\n')}\n}`
  }

  // Generate JavaScript code to display
  let jsCode: string

  if (Array.isArray(parsedInput)) {
    if (parsedInput.length === 0) {
      jsCode = '[]'
    } else {
      const firstItem = parsedInput[0]
      const remaining = parsedInput.length - 1

      if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
        // First item is an object - format it with attribute limit
        const formattedObject = formatObject(firstItem)
        if (remaining > 0) {
          jsCode = `[\n${formattedObject
            .split('\n')
            .map(line => `  ${line}`)
            .join('\n')},\n  // and ${remaining} more ${remaining === 1 ? 'item' : 'items'}\n]`
        } else {
          jsCode = `[\n${formattedObject
            .split('\n')
            .map(line => `  ${line}`)
            .join('\n')}\n]`
        }
      } else {
        // First item is primitive or array
        const formattedValue = formatValue(firstItem)
        if (remaining > 0) {
          jsCode = `[\n  ${formattedValue},\n  // and ${remaining} more ${remaining === 1 ? 'item' : 'items'}\n]`
        } else {
          jsCode = `[${formattedValue}]`
        }
      }
    }
  } else if (typeof parsedInput === 'object' && parsedInput !== null) {
    // Single object - format with attribute limit
    jsCode = formatObject(parsedInput)
  } else {
    // Primitive value
    jsCode = formatValue(parsedInput)
  }

  // Wrap in markdown code block with javascript syntax
  const markdownContent = `\`\`\`javascript\n${jsCode}\n\`\`\``

  return (
    <div className={`mt-1 transition-opacity duration-200 ${isDim ? 'opacity-50' : 'opacity-100'}`}>
      <MarkdownRenderer content={markdownContent} sanitize={false} />
    </div>
  )
}
