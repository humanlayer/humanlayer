import React, { useEffect, forwardRef, useImperativeHandle } from 'react'
import { useEditor, EditorContent, Extension, Content } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin } from '@tiptap/pm/state'
import { createLowlight } from 'lowlight'
import clojure from 'highlight.js/lib/languages/clojure'
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
import { logger } from '@/lib/logging'
import { useStore } from '@/AppStore'

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
lowlight.register('clojure', clojure)
lowlight.register('clj', clojure)

// Create a custom extension that highlights markdown syntax
const MarkdownSyntaxHighlight = Extension.create({
  name: 'markdownSyntaxHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state: any) => {
            const doc = state.doc
            const decorations: Decoration[] = []

            // Track code blocks and collect lines
            let inCodeBlock = false
            let codeBlockLang = ''
            const codeBlockLines: Array<{ pos: number; text: string }> = []

            // First pass: collect code block lines and apply syntax highlighting per line
            doc.descendants((node: any, pos: number) => {
              if (node.isText && node.text) {
                const text = node.text

                if (text.startsWith('```')) {
                  if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true
                    codeBlockLang = text.substring(3).trim()
                    codeBlockLines.length = 0
                  } else {
                    // Ending a code block - process all collected lines
                    if (
                      codeBlockLines.length > 0 &&
                      codeBlockLang &&
                      lowlight.registered(codeBlockLang)
                    ) {
                      // Process each line individually to maintain correct positions
                      codeBlockLines.forEach(line => {
                        try {
                          // Highlight this specific line
                          const result = lowlight.highlight(codeBlockLang, line.text)

                          // Build segments for this line
                          let currentOffset = 0
                          const segments: Array<{ start: number; end: number; classes: string[] }> = []

                          const processNode = (node: any, parentClasses: string[] = []): void => {
                            if (node.type === 'text') {
                              const len = node.value?.length || 0
                              if (len > 0) {
                                segments.push({
                                  start: currentOffset,
                                  end: currentOffset + len,
                                  classes: parentClasses,
                                })
                                currentOffset += len
                              }
                            } else if (node.type === 'element') {
                              const classes = node.properties?.className || []
                              const combinedClasses = [...parentClasses, ...classes]
                              if (node.children) {
                                node.children.forEach((child: any) =>
                                  processNode(child, combinedClasses),
                                )
                              }
                            } else if (node.type === 'root') {
                              if (node.children) {
                                node.children.forEach((child: any) => processNode(child, []))
                              }
                            }
                          }

                          processNode(result)

                          // Apply decorations for this line
                          segments.forEach(segment => {
                            const allClasses = ['markdown-codeblock-content', ...segment.classes]
                            decorations.push(
                              Decoration.inline(line.pos + segment.start, line.pos + segment.end, {
                                class: allClasses.join(' '),
                              }),
                            )
                          })
                        } catch (e) {
                          logger.error('Highlight error for line:', e)
                        }
                      })
                    }

                    inCodeBlock = false
                    codeBlockLang = ''
                    codeBlockLines.length = 0
                  }
                } else if (inCodeBlock) {
                  // Collect code block content lines
                  codeBlockLines.push({
                    pos: pos,
                    text: text,
                  })
                }
              }
            })

            // Second pass: apply decorations for markdown syntax (not code blocks)
            let trackingCodeBlock = false
            doc.descendants((node: any, pos: number) => {
              if (node.isText && node.text) {
                const text = node.text

                // Track if we're inside a code block
                if (text.startsWith('```')) {
                  trackingCodeBlock = !trackingCodeBlock
                }

                const insideCodeBlock = trackingCodeBlock && !text.startsWith('```')

                // Check for code block fences
                if (text.startsWith('```')) {
                  // Style the ``` markers
                  decorations.push(
                    Decoration.inline(pos, pos + 3, {
                      class: 'markdown-syntax markdown-syntax-codeblock',
                    }),
                  )

                  // If there's a language after ```
                  const afterFence = text.substring(3).trim()
                  if (afterFence) {
                    decorations.push(
                      Decoration.inline(pos + 3, pos + text.length, {
                        class: 'markdown-codeblock-lang',
                      }),
                    )
                  }

                  return // Don't process other markdown in code fence lines
                }

                // Skip processing if inside a code block (already handled above)
                if (insideCodeBlock) {
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
                    Decoration.inline(start, start + 2, {
                      class: 'markdown-syntax markdown-syntax-bold',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 2, end - 2, { class: 'markdown-bold' }))
                }

                // Match __bold__ syntax
                const underscoreBoldRegex = /__([^_]+)__/g
                while ((match = underscoreBoldRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the underscores
                  decorations.push(
                    Decoration.inline(start, start + 2, {
                      class: 'markdown-syntax markdown-syntax-bold',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, { class: 'markdown-syntax markdown-syntax-bold' }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 2, end - 2, { class: 'markdown-bold' }))
                }

                // Match *italic* syntax (careful not to match bold)
                const italicRegex = /(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g
                while ((match = italicRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the asterisks
                  decorations.push(
                    Decoration.inline(start, start + 1, {
                      class: 'markdown-syntax markdown-syntax-italic',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, {
                      class: 'markdown-syntax markdown-syntax-italic',
                    }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 1, end - 1, { class: 'markdown-italic' }))
                }

                // Match _italic_ syntax (careful not to match bold)
                const underscoreItalicRegex = /(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g
                while ((match = underscoreItalicRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the underscores
                  decorations.push(
                    Decoration.inline(start, start + 1, {
                      class: 'markdown-syntax markdown-syntax-italic',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, {
                      class: 'markdown-syntax markdown-syntax-italic',
                    }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 1, end - 1, { class: 'markdown-italic' }))
                }

                // Match ~~strikethrough~~ syntax
                const strikeRegex = /~~([^~]+)~~/g
                while ((match = strikeRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the tildes
                  decorations.push(
                    Decoration.inline(start, start + 2, {
                      class: 'markdown-syntax markdown-syntax-strike',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 2, end, {
                      class: 'markdown-syntax markdown-syntax-strike',
                    }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 2, end - 2, { class: 'markdown-strike' }))
                }

                // Match `code` syntax
                const codeRegex = /`([^`]+)`/g
                while ((match = codeRegex.exec(text)) !== null) {
                  const start = pos + match.index
                  const end = start + match[0].length

                  // Style the backticks
                  decorations.push(
                    Decoration.inline(start, start + 1, {
                      class: 'markdown-syntax markdown-syntax-code',
                    }),
                  )
                  decorations.push(
                    Decoration.inline(end - 1, end, { class: 'markdown-syntax markdown-syntax-code' }),
                  )

                  // Style the content
                  decorations.push(Decoration.inline(start + 1, end - 1, { class: 'markdown-code' }))
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
                    Decoration.inline(start, hashEnd, {
                      class: `markdown-syntax markdown-syntax-heading-${hashLength}`,
                    }),
                  )

                  // Style the heading content based on level
                  if (spaceEnd < end) {
                    decorations.push(
                      Decoration.inline(spaceEnd, end, {
                        class: `markdown-heading markdown-heading-${hashLength}`,
                      }),
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

                  // Style the bullet marker
                  decorations.push(
                    Decoration.inline(bulletStart, bulletEnd, {
                      class: 'markdown-syntax markdown-syntax-list',
                    }),
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
                    Decoration.inline(numberStart, dotEnd, {
                      class: 'markdown-syntax markdown-syntax-list',
                    }),
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

const KeyboardShortcuts = Extension.create({
  name: 'KeyboardShortcuts',
  addOptions() {
    return {
      onSubmit: undefined,
      onToggleAutoAccept: undefined,
      onToggleDangerouslySkipPermissions: undefined,
    }
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => this.editor.commands.blur(),
      'Mod-Enter': editor => {
        if (!editor.editor.isEmpty) {
          this.options.onSubmit?.()
        }
        return true
      },
      'Shift-Tab': () => {
        this.options.onToggleAutoAccept?.()
        return true // Prevent default tab behavior
      },
      'Alt-y': () => {
        this.options.onToggleDangerouslySkipPermissions?.()
        return true
      },
    }
  },
})

interface ResponseEditorProps {
  initialValue: Content | null 
  onChange: (value: Content) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  onFocus?: () => void
  onBlur?: () => void
  onSubmit?: () => void
  onToggleAutoAccept?: () => void
  onToggleDangerouslySkipPermissions?: () => void
}

export const ResponseEditor = forwardRef<{ focus: () => void }, ResponseEditorProps>(
  (
    { initialValue, onChange, onKeyDown, disabled, placeholder, className, onFocus, onBlur, onSubmit, onToggleAutoAccept, onToggleDangerouslySkipPermissions },
    ref,
  ) => {
    const onSubmitRef = React.useRef<ResponseEditorProps['onSubmit']>()
    const onChangeRef = React.useRef<ResponseEditorProps['onChange']>()
    const onToggleAutoAcceptRef = React.useRef<ResponseEditorProps['onToggleAutoAccept']>()
    const onToggleDangerouslySkipPermissionsRef = React.useRef<ResponseEditorProps['onToggleDangerouslySkipPermissions']>()

    const setResponseEditor = useStore(state => state.setResponseEditor)
    const removeResponseEditor = useStore(state => state.removeResponseEditor)

    useEffect(() => { onSubmitRef.current = onSubmit }, [onSubmit])
    useEffect(() => { onChangeRef.current = onChange }, [onChange])
    useEffect(() => { onToggleAutoAcceptRef.current = onToggleAutoAccept }, [onToggleAutoAccept])
    useEffect(() => { onToggleDangerouslySkipPermissionsRef.current = onToggleDangerouslySkipPermissions }, [onToggleDangerouslySkipPermissions])

    const editor = useEditor({
      autofocus: false,
      extensions: [
        StarterKit.configure({
          // Disable these extensions since we want to show markdown syntax
          heading: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          hardBreak: false,
        }),
        MarkdownSyntaxHighlight,
        KeyboardShortcuts.configure({
          onSubmit: () => onSubmitRef.current?.(),
          onToggleAutoAccept: () => onToggleAutoAcceptRef.current?.(),
          onToggleDangerouslySkipPermissions: () => onToggleDangerouslySkipPermissionsRef.current?.(),
        }),
        Placeholder.configure({
          placeholder: placeholder || 'Type something...',
        }),
      ],
      content: initialValue,
      editorProps: {
        attributes: {
          class: `tiptap-editor ${className || ''}`,
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
        },
      },
      onUpdate: ({ editor }) => onChangeRef.current?.(editor.getJSON()),
      editable: !disabled,

      enableInputRules: false,
      enablePasteRules: false,
    })

    // Handle editable state
    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled)
      }
    }, [disabled, editor])

    // Expose focus and blur methods
    useImperativeHandle(ref, () => ({
      focus: () => {
        editor?.commands.focus()
      },
      blur: () => {
        editor?.commands.blur()
      },
    }))

    useEffect(() => {
      logger.log('ResponseEditor.useEffect() - setting response editor')
      setResponseEditor(editor)
      return () => {
        logger.log('TiptapEditor.useEffect() - destroying editor')
        editor?.destroy()
        removeResponseEditor()
      }
    }, [editor, setResponseEditor, removeResponseEditor])

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
        <EditorContent editor={editor} onFocus={onFocus} onBlur={onBlur} />
      </div>
    )
  },
)

ResponseEditor.displayName = 'ResponseEditor'
