# Anthropic SDK Response Schema

## Message (API Response)

```typescript
interface Message {
  id: string
  type: 'message'
  role: 'assistant'
  model: string // e.g. "claude-3-5-sonnet-20241022"
  content: ContentBlock[]
  stop_reason:
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | 'pause_turn'
    | 'refusal'
    | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    server_tool_use?: { web_search_requests: number }
    service_tier?: 'standard' | 'priority' | 'batch'
  }
}
```

## Content Blocks

Content blocks are the building blocks of a message's content array. Each block has a `type` field that determines its structure:

```typescript
type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ServerToolUseBlock
  | WebSearchToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock

interface TextBlock {
  type: 'text'
  text: string
  citations?: Array<{
    // Citations reference source documents
    // Structure varies by document type (PDF, text, etc.)
  }>
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: object // Tool-specific JSON parameters
}

interface ServerToolUseBlock {
  type: 'server_tool_use'
  // Server-side tool execution details
}

interface WebSearchToolResultBlock {
  type: 'web_search_tool_result'
  // Web search results
}

interface ThinkingBlock {
  type: 'thinking'
  // Model's reasoning process (when enabled)
}

interface RedactedThinkingBlock {
  type: 'redacted_thinking'
  // Redacted reasoning (privacy mode)
}
```

## Example Message

```json
{
  "id": "msg_123",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-5-sonnet-20241022",
  "content": [
    {
      "type": "text",
      "text": "I'll help you with that calculation."
    },
    {
      "type": "tool_use",
      "id": "toolu_456",
      "name": "calculator",
      "input": { "expression": "2 + 2" }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 50,
    "output_tokens": 25
  }
}
```
