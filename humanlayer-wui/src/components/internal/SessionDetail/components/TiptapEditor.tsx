import React, { useEffect, forwardRef, useImperativeHandle } from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin } from '@tiptap/pm/state'
import { createLowlight } from 'lowlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import '@/styles/tiptap-editor.css'

// Create lowlight instance with common languages
const lowlight = createLowlight()
lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('python', python)
lowlight.register('py', python)
lowlight.register('rust', rust)
lowlight.register('rs', rust)
lowlight.register('go', go)
lowlight.register('java', java)
lowlight.register('cpp', cpp)
lowlight.register('c++', cpp)
lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('json', json)
lowlight.register('markdown', markdown)
lowlight.register('md', markdown)
lowlight.register('xml', xml)
lowlight.register('html', xml)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)

// Create a custom extension that highlights markdown syntax
const MarkdownSyntaxHighlight = Extension.create({
  name: 'markdownSyntaxHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state: any) => {
            const decorations: Decoration[] = []
            const doc = state.doc
            
            // Track code blocks - first pass to identify code block boundaries
            let inCodeBlock = false
            let codeBlockLang = ''
            let codeBlockContent = ''
            let codeBlockContentStart = 0
            const codeBlockRanges: Array<{start: number, end: number, lang: string, content: string}> = []
            
            // First pass: identify code blocks
            doc.descendants((node: any, pos: number) => {
              if (node.isText && node.text) {
                const text = node.text
                
                if (text.startsWith('```')) {
                  if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true
                    codeBlockLang = text.substring(3).trim()
                    codeBlockContent = ''
                    codeBlockContentStart = pos + text.length + 1 // After this line
                  } else {
                    // Ending a code block
                    if (codeBlockContent) {
                      codeBlockRanges.push({
                        start: codeBlockContentStart,
                        end: pos - 1, // Before this line
                        lang: codeBlockLang,
                        content: codeBlockContent.trim()
                      })
                    }
                    inCodeBlock = false
                    codeBlockLang = ''
                    codeBlockContent = ''
                  }
                } else if (inCodeBlock) {
                  // Accumulate code block content
                  codeBlockContent += text + '\n'
                }
              }
            })
            
            // Apply syntax highlighting to code blocks
            codeBlockRanges.forEach(range => {
              if (range.lang && lowlight.registered(range.lang) && range.content) {
                try {
                  // lowlight v3 API: highlight(language, text)
                  const result = lowlight.highlight(range.lang, range.content)
                  
                  // Process the tree structure returned by lowlight v3
                  let currentOffset = 0
                  
                  const processNode = (node: any): void => {
                    if (node.type === 'text') {
                      const len = node.value?.length || 0
                      currentOffset += len
                    } else if (node.type === 'element') {
                      const classes = node.properties?.className || []
                      const startOffset = currentOffset
                      
                      // Process children to get length
                      if (node.children) {
                        node.children.forEach(processNode)
                      }
                      
                      if (classes.length > 0 && startOffset < currentOffset) {
                        decorations.push(
                          Decoration.inline(range.start + startOffset, range.start + currentOffset, { 
                            class: classes.map((c: string) => c.startsWith('hljs') ? c : `hljs-${c}`).join(' ')
                          })
                        )
                      }
                    }
                  }
                  
                  // Process the root children
                  if (result.children) {
                    result.children.forEach(processNode)
                  }
                } catch (e) {
                  console.error('Highlight error:', e)
                }
              }
            })
            
            // Second pass: apply decorations
            doc.descendants((node: any, pos: number) => {
              if (node.isText && node.text) {
                const text = node.text
                
                // Check if we're inside a code block
                const insideCodeBlock = codeBlockRanges.some(range => 
                  pos >= range.start && pos < range.end
                )

                // Check for code block fences
                if (text.startsWith('```')) {
                  // Style the ``` markers
                  decorations.push(
                    Decoration.inline(pos, pos + 3, { 
                      class: 'markdown-syntax markdown-syntax-codeblock' 
                    })
                  )
                  
                  // If there's a language after ```
                  const afterFence = text.substring(3).trim()
                  if (afterFence) {
                    decorations.push(
                      Decoration.inline(pos + 3, pos + text.length, { 
                        class: 'markdown-codeblock-lang' 
                      })
                    )
                  }
                  
                  return // Don't process other markdown in code fence lines
                }
                
                // Apply syntax highlighting if inside a code block
                if (insideCodeBlock) {
                  // First, apply base code block styling
                  decorations.push(
                    Decoration.inline(pos, pos + text.length, { 
                      class: 'markdown-codeblock-content' 
                    })
                  )
                  
                  return // Don't process other markdown inside code blocks
                }

                // Match **bold** syntax
                const boldRegex = /\*\*([^*]+)\*\*/g
                let match

                while ((match = boldRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the asterisks
                  decorations.push(
                    Decoration.inline(start, start + 2, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 2, end - 2, { class: 'markdown-bold' }),
                  )
                }

                // Match __bold__ syntax
                const underscoreBoldRegex = /__([^_]+)__/g
                while ((match = underscoreBoldRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the underscores
                  decorations.push(
                    Decoration.inline(start, start + 2, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 2, end - 2, { class: 'markdown-bold' }),
                  )
                }

                // Match *italic* syntax (careful not to match bold)
                const italicRegex = /(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g
                while ((match = italicRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the asterisks
                  decorations.push(
                    Decoration.inline(start, start + 1, { class: 'markdown-syntax markdown-syntax-italic' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, { class: 'markdown-syntax markdown-syntax-italic' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 1, end - 1, { class: 'markdown-italic' }),
                  )
                }

                // Match _italic_ syntax (careful not to match bold)
                const underscoreItalicRegex = /(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g
                while ((match = underscoreItalicRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the underscores
                  decorations.push(
                    Decoration.inline(start, start + 1, { class: 'markdown-syntax markdown-syntax-italic' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, { class: 'markdown-syntax markdown-syntax-italic' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 1, end - 1, { class: 'markdown-italic' }),
                  )
                }

                // Match ~~strikethrough~~ syntax
                const strikeRegex = /~~([^~]+)~~/g
                while ((match = strikeRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the tildes
                  decorations.push(
                    Decoration.inline(start, start + 2, { class: 'markdown-syntax markdown-syntax-strike' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, { class: 'markdown-syntax markdown-syntax-strike' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 2, end - 2, { class: 'markdown-strike' }),
                  )
                }

                // Match `code` syntax
                const codeRegex = /`([^`]+)`/g
                while ((match = codeRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the backticks
                  decorations.push(
                    Decoration.inline(start, start + 1, { class: 'markdown-syntax markdown-syntax-code' }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, { class: 'markdown-syntax markdown-syntax-code' }),
                  )

                  // Style the content
                  decorations.push(
                    Decoration.inline(start + 1, end - 1, { class: 'markdown-code' }),
                  )
                }

                // Match heading syntax at the beginning of the line
                const headingRegex = /^(#{1,6})\s+(.*)$/
                const headingMatch = headingRegex.exec(text)
                if (headingMatch) {
                  const start = pos
                  const hashLength = headingMatch[1].length
                  const hashEnd = start + hashLength
                  const spaceEnd = hashEnd + 1 // for the space after hashes
                  const end = start + text.length

                  // Style the hash symbols
                  decorations.push(
                    Decoration.inline(start, hashEnd, { class: `markdown-syntax markdown-syntax-heading-${hashLength}` }),
                  )

                  // Style the heading content based on level
                  if (spaceEnd < end) {
                    decorations.push(
                      Decoration.inline(spaceEnd, end, { class: `markdown-heading markdown-heading-${hashLength}` }),
                    )
                  }
                }

                // Match unordered list syntax at the beginning of the line
                const unorderedListRegex = /^(\s*)([-*+])\s+(.*)$/
                const unorderedListMatch = unorderedListRegex.exec(text)
                if (unorderedListMatch) {
                  const start = pos
                  const indent = unorderedListMatch[1].length
                  const bulletStart = start + indent
                  const bulletEnd = bulletStart + 1
                  const spaceEnd = bulletEnd + 1

                  // Style the bullet marker
                  decorations.push(
                    Decoration.inline(bulletStart, bulletEnd, { class: 'markdown-syntax markdown-syntax-list' }),
                  )
                }

                // Match ordered list syntax at the beginning of the line
                const orderedListRegex = /^(\s*)(\d+)\.\s+(.*)$/
                const orderedListMatch = orderedListRegex.exec(text)
                if (orderedListMatch) {
                  const start = pos
                  const indent = orderedListMatch[1].length
                  const numberStart = start + indent
                  const numberEnd = numberStart + orderedListMatch[2].length
                  const dotEnd = numberEnd + 1 // for the dot

                  // Style the number and dot
                  decorations.push(
                    Decoration.inline(numberStart, dotEnd, { class: 'markdown-syntax markdown-syntax-list' }),
                  )
                }
              }
            })

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

interface TiptapEditorProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

export const TiptapEditor = forwardRef<{ focus: () => void }, TiptapEditorProps>(
  ({ value, onChange, onKeyDown, disabled, placeholder, className }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable these extensions since we want to show markdown syntax
          heading: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,  // Disable since we want to preserve markdown syntax
        }),
        // CodeBlockLowlight.configure({
        //   lowlight,
        //   defaultLanguage: 'plaintext',
        // }),
        MarkdownSyntaxHighlight,
      ],
      content: value,
      editorProps: {
        attributes: {
          class: `tiptap-editor ${className || ''}`,
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
        },
      },
      onUpdate: ({ editor }) => {
        const text = editor.getText()
        onChange(text)
      },
      editable: !disabled,

      enableInputRules: false,
      enablePasteRules: false,
    })

    // Sync external value changes
    useEffect(() => {
      if (editor && value !== editor.getText()) {
        editor.commands.setContent(value)
      }
    }, [value, editor])

    // Handle editable state
    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled)
      }
    }, [disabled, editor])

    // Expose focus method
    useImperativeHandle(ref, () => ({
      focus: () => {
        editor?.commands.focus()
      },
    }))

    // Handle keyboard events
    useEffect(() => {
      if (!editor || !onKeyDown) return

      const handleKeyDown = (e: KeyboardEvent) => {
        // Create a synthetic React keyboard event
        const syntheticEvent = {
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
          nativeEvent: e,
        } as React.KeyboardEvent

        onKeyDown(syntheticEvent)
      }

      const editorElement = editor.view.dom
      editorElement.addEventListener('keydown', handleKeyDown)

      return () => {
        editorElement.removeEventListener('keydown', handleKeyDown)
      }
    }, [editor, onKeyDown])

    return (
      <div className="tiptap-wrapper">
        <EditorContent editor={editor} placeholder={placeholder} />
      </div>
    )
  },
)

TiptapEditor.displayName = 'TiptapEditor'