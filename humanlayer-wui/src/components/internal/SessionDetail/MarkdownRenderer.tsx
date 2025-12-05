import React, { memo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { Copy, Check } from 'lucide-react'
import type { Components } from 'react-markdown'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/utils/clipboard'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import { useStore } from '@/AppStore'

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
import { CommandToken } from '../CommandToken'
import { ResearchPlanToken } from './ResearchPlanToken'

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
  workingDir?: string
}

// Match both research paths and plan paths for the context menu
const researchPlanPathRegex = /thoughts\/shared\/(research|plans)\//

const MarkdownRendererInner = memo(({ content, className = '', workingDir }: MarkdownRendererProps) => {
  const [copiedBlocks, setCopiedBlocks] = React.useState<Set<string>>(new Set())
  const sessionWorkingDir = useStore(state => state.activeSessionDetail?.session?.workingDir)
  const effectiveWorkingDir = workingDir ?? sessionWorkingDir ?? ''

  const handleCopy = useCallback(async (code: string, id: string) => {
    const success = await copyToClipboard(code)
    if (success) {
      setCopiedBlocks(prev => new Set([...prev, id]))
      setTimeout(() => {
        setCopiedBlocks(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 2000)
    }
  }, [])

  const components: Components = React.useMemo(
    () => ({
      h1({ children }) {
        return <h1># {children}</h1>
      },
      h2({ children }) {
        return <h2>## {children}</h2>
      },
      h3({ children }) {
        return <h3>### {children}</h3>
      },
      h4({ children }) {
        return <h4>#### {children}</h4>
      },
      h5({ children }) {
        return <h5>##### {children}</h5>
      },
      h6({ children }) {
        return <h6>###### {children}</h6>
      },
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
        return <p style={{ display: isInList ? 'inline' : 'block' }}>{children}</p>
      },
      pre({ children }) {
        // Mark the code element as being inside a pre block
        const codeElement = children as any
        if (codeElement?.props) {
          // Pass a flag to the code component indicating it's in a pre block
          return <pre>{React.cloneElement(codeElement, { 'data-is-block': true })}</pre>
        }
        return <pre>{children}</pre>
      },
      code(props) {
        const { className, children, ...rest } = props as any
        const codeString = String(children).replace(/\n$/, '')
        const codeId = `code-${Math.random().toString(36).substr(2, 9)}`

        // Check if this code is inside a pre block
        const isBlock = rest['data-is-block'] === true

        // Extract language if present
        const match = /language-(\w+)/.exec(className || '')
        const language = match?.[1] ?? 'plaintext'

        return isBlock ? (
          <SyntaxHighlighter
            language={language}
            useInlineStyles={false}
            className="rsh-code-block text-sm grid relative min-w-[250px]"
            codeTagProps={{
              className: 'overflow-x-auto',
            }}
            PreTag={({ children, ...props }) => (
              <pre className="rsh-pre" {...props}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 touch:opacity-100 md:touch:opacity-0 md:touch:group-hover:opacity-100 bg-[var(--terminal-bg-alt)] hover:bg-[var(--terminal-bg-alt)]"
                  onClick={e => {
                    e.stopPropagation()
                    handleCopy(codeString, codeId)
                  }}
                  aria-label="Copy code"
                  title="Copy code"
                >
                  {copiedBlocks.has(codeId) ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                {children}
              </pre>
            )}
          >
            {codeString}
          </SyntaxHighlighter>
        ) : researchPlanPathRegex.test(codeString) ? (
          <ResearchPlanToken path={codeString.trim()} workingDir={effectiveWorkingDir} />
        ) : (
          <CommandToken>{children}</CommandToken>
        )
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
    }),
    [handleCopy, copiedBlocks, effectiveWorkingDir],
  )

  return (
    <ReactMarkdown
      className={`prose-terminal ${className}`}
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
})

MarkdownRendererInner.displayName = 'MarkdownRendererInner'

export const MarkdownRenderer = memo((props: MarkdownRendererProps) => (
  <SentryErrorBoundary
    variant="markdown"
    componentName="MarkdownRenderer"
    handleRefresh={() => {
      // Clear URL params and reload
      const sessionId = window.location.hash.match(/sessions\/([^/?]+)/)?.[1]
      if (sessionId) {
        window.location.href = `/#/sessions/${sessionId}`
      } else {
        window.location.href = '/#/'
      }
    }}
    refreshButtonText="Reload Session"
  >
    <MarkdownRendererInner {...props} />
  </SentryErrorBoundary>
))

MarkdownRenderer.displayName = 'MarkdownRenderer'
