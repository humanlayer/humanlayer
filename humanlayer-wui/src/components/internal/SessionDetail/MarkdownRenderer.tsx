import React, { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import DOMPurify from 'dompurify'
import { Copy, Check } from 'lucide-react'
import type { Components } from 'react-markdown'

// Import only needed languages for smaller bundle
import json from 'react-syntax-highlighter/dist/cjs/languages/prism/json'
import typescript from 'react-syntax-highlighter/dist/cjs/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/cjs/languages/prism/tsx'
import javascript from 'react-syntax-highlighter/dist/cjs/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/cjs/languages/prism/jsx'
import python from 'react-syntax-highlighter/dist/cjs/languages/prism/python'
import go from 'react-syntax-highlighter/dist/cjs/languages/prism/go'
import rust from 'react-syntax-highlighter/dist/cjs/languages/prism/rust'
import bash from 'react-syntax-highlighter/dist/cjs/languages/prism/bash'
import lua from 'react-syntax-highlighter/dist/cjs/languages/prism/lua'
import clojure from 'react-syntax-highlighter/dist/cjs/languages/prism/clojure'
import zig from 'react-syntax-highlighter/dist/cjs/languages/prism/zig'

// Register languages
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('py', python)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('rs', rust)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('lua', lua)
SyntaxHighlighter.registerLanguage('clojure', clojure)
SyntaxHighlighter.registerLanguage('clj', clojure)
SyntaxHighlighter.registerLanguage('zig', zig)

interface MarkdownRendererProps {
  content: string
  className?: string
  sanitize?: boolean
}

// DOMPurify configuration
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'span',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'del',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'hr',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
}

export const MarkdownRenderer = memo(
  ({ content, className = '', sanitize = true }: MarkdownRendererProps) => {
    const [copiedBlocks, setCopiedBlocks] = React.useState<Set<string>>(new Set())

    const sanitizedContent = sanitize ? DOMPurify.sanitize(content, DOMPURIFY_CONFIG) : content

    const handleCopy = async (code: string, id: string) => {
      await navigator.clipboard.writeText(code)
      setCopiedBlocks(prev => new Set([...prev, id]))
      setTimeout(() => {
        setCopiedBlocks(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 2000)
    }

    const components: Components = {
      li({ children }) {
        // Remove any leading whitespace/newlines from list items
        // This fixes the issue where numbered lists have newlines between number and text
        if (Array.isArray(children)) {
          // Filter out pure whitespace text nodes at the beginning
          const filteredChildren = children.filter((child, index) => {
            if (index === 0 && typeof child === 'string' && child.trim() === '') {
              return false
            }
            return true
          })
          return <li>{filteredChildren}</li>
        }
        return <li>{children}</li>
      },
      p({ children, ...props }) {
        // Check if we're inside a list item
        const isInList = (props as any).node?.parent?.tagName === 'li'
        // Let CSS handle margins, only control display
        return (
          <p style={{ display: isInList ? 'inline' : 'block' }}>
            {children}
          </p>
        )
      },
      code(props) {
        const { className, children } = props as any
        // Check if it's an inline code or code block by looking at the presence of language class
        const match = /language-(\w+)/.exec(className || '')
        const codeString = String(children).replace(/\n$/, '')
        const codeId = `code-${Math.random().toString(36).substr(2, 9)}`

        return match ? (
          <div className="relative group">
            <SyntaxHighlighter
              language={match[1]}
              useInlineStyles={false}
              className="rsh-code-block text-sm"
              PreTag={({ children, ...props }) => (
                <pre className="rsh-pre" {...props}>
                  {children}
                </pre>
              )}
            >
              {codeString}
            </SyntaxHighlighter>
            <button
              onClick={() => handleCopy(codeString, codeId)}
              className="absolute top-2 right-2 p-1.5 bg-background/80 border border-border rounded-none opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Copy code"
            >
              {copiedBlocks.has(codeId) ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        ) : (
          <code className="px-1 py-0.5 bg-accent/20 text-accent rounded-none text-sm font-mono">
            {children}
          </code>
        )
      },
      pre({ children }) {
        // Pre is handled by code block above
        return <>{children}</>
      },
      a({ href, children }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline hover:text-accent/80 transition-colors"
          >
            {children}
          </a>
        )
      },
    }

    return (
      <ReactMarkdown
        className={`prose-terminal ${className}`}
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {sanitizedContent}
      </ReactMarkdown>
    )
  },
)

MarkdownRenderer.displayName = 'MarkdownRenderer'
