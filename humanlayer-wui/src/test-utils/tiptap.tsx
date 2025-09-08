import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'

/**
 * Create a test editor hook with common extensions
 * This is a custom hook and must be called from within a React component
 */
export const useTestEditor = (options = {}) => {
  return useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: {
          'data-testid': 'mention',
        },
        ...options,
      }),
    ],
    content: '',
  })
}

/**
 * Test component for rendering TipTap editors in tests
 */
interface TestEditorProps {
  content?: string
  onUpdate?: (json: any) => void
  mentionOptions?: any
  extensions?: any[]
}

export const TestEditor = ({
  content = '',
  onUpdate,
  mentionOptions = {},
  extensions = [],
}: TestEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: {
          'data-testid': 'mention',
        },
        ...mentionOptions,
      }),
      ...extensions,
    ],
    content,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getJSON())
    },
  })

  return <EditorContent editor={editor} data-testid="test-editor" />
}

/**
 * Helper to create a mention node for testing
 */
export const createMentionNode = (id: string, label: string) => ({
  type: 'mention',
  attrs: { id, label },
})

/**
 * Helper to create a text node for testing
 */
export const createTextNode = (text: string) => ({
  type: 'text',
  text,
})

/**
 * Helper to create a paragraph with mixed content
 */
export const createParagraph = (...nodes: any[]) => ({
  type: 'paragraph',
  content: nodes,
})

/**
 * Helper to create a complete document
 */
export const createDocument = (...paragraphs: any[]) => ({
  type: 'doc',
  content: paragraphs,
})

/**
 * Mock suggestion configuration for testing
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createMockSuggestion = (items: any[] = [], onSelectItem = (_item: any) => {}) => ({
  items: ({ query }: { query: string }) => {
    // Filter items based on query if provided
    if (query) {
      return items.filter((item: any) => item.label?.toLowerCase().includes(query.toLowerCase()))
    }
    return items
  },
  render: () => {
    let selectedIndex = 0

    return {
      onStart: (props: any) => {
        selectedIndex = 0
        props.items = items
      },
      onUpdate: (props: any) => {
        props.items = items
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowDown') {
          selectedIndex = (selectedIndex + 1) % items.length
          return true
        }
        if (event.key === 'ArrowUp') {
          selectedIndex = (selectedIndex - 1 + items.length) % items.length
          return true
        }
        if (event.key === 'Enter') {
          onSelectItem(items[selectedIndex])
          return true
        }
        return false
      },
      onExit: () => {
        selectedIndex = 0
      },
    }
  },
})

/**
 * Helper to simulate typing in a TipTap editor
 */
export const simulateTyping = (editor: any, text: string) => {
  if (!editor) return

  // Insert text at current position
  editor.chain().focus().insertContent(text).run()
}

/**
 * Helper to simulate mention insertion
 */
export const insertMention = (editor: any, id: string, label: string) => {
  if (!editor) return

  editor
    .chain()
    .focus()
    .insertContent({
      type: 'mention',
      attrs: { id, label },
    })
    .run()
}

/**
 * Helper to get all mentions from editor content
 */
export const getMentions = (content: any): Array<{ id: string; label: string }> => {
  const mentions: Array<{ id: string; label: string }> = []

  const traverse = (node: any) => {
    if (node.type === 'mention') {
      mentions.push({
        id: node.attrs.id,
        label: node.attrs.label,
      })
    }
    if (node.content) {
      node.content.forEach(traverse)
    }
  }

  traverse(content)
  return mentions
}

/**
 * Helper to extract plain text with mentions as @filepath
 */
export const extractTextWithMentions = (content: any): string => {
  if (!content) return ''

  const processNode = (node: any): string => {
    if (node.type === 'text') {
      return node.text || ''
    } else if (node.type === 'mention') {
      // Use the full path (id) instead of label
      return `@${node.attrs.id || node.attrs.label || ''}`
    } else if (node.type === 'paragraph' && node.content) {
      return node.content.map(processNode).join('')
    } else if (node.content) {
      return node.content.map(processNode).join('\n')
    }
    return ''
  }

  if (content.content) {
    return content.content.map(processNode).join('\n')
  }

  return ''
}
