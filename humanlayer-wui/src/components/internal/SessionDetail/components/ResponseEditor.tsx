import React, { useEffect, forwardRef, useImperativeHandle, useState, useRef } from 'react'
import { useEditor, EditorContent, Extension, Content, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import Mention from '@tiptap/extension-mention'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin } from '@tiptap/pm/state'
import { FileMentionList, FileMentionListRef } from './FileMentionList'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import { openPath } from '@tauri-apps/plugin-opener'

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
      onToggleForkView: undefined,
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
      'Mod-y': () => {
        this.options.onToggleForkView?.()
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
  onToggleForkView?: () => void
}

export const ResponseEditor = forwardRef<{ focus: () => void }, ResponseEditorProps>(
  (
    {
      initialValue,
      onChange,
      onKeyDown,
      disabled,
      placeholder,
      className,
      onFocus,
      onBlur,
      onSubmit,
      onToggleAutoAccept,
      onToggleDangerouslySkipPermissions,
      onToggleForkView,
    },
    ref,
  ) => {
    const onSubmitRef = React.useRef<ResponseEditorProps['onSubmit']>()
    const onChangeRef = React.useRef<ResponseEditorProps['onChange']>()
    const onToggleAutoAcceptRef = React.useRef<ResponseEditorProps['onToggleAutoAccept']>()
    const onToggleDangerouslySkipPermissionsRef =
      React.useRef<ResponseEditorProps['onToggleDangerouslySkipPermissions']>()
    const onToggleForkViewRef = React.useRef<ResponseEditorProps['onToggleForkView']>()

    // Tooltip state for file mentions
    const [tooltipState, setTooltipState] = useState<{
      open: boolean
      content: string
      x: number
      y: number
    } | null>(null)

    // Virtual anchor element for tooltip positioning
    const virtualAnchor = useRef<HTMLDivElement>(null)

    const setResponseEditor = useStore(state => state.setResponseEditor)
    const removeResponseEditor = useStore(state => state.removeResponseEditor)

    useEffect(() => {
      onSubmitRef.current = onSubmit
    }, [onSubmit])
    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])
    useEffect(() => {
      onToggleAutoAcceptRef.current = onToggleAutoAccept
    }, [onToggleAutoAccept])
    useEffect(() => {
      onToggleDangerouslySkipPermissionsRef.current = onToggleDangerouslySkipPermissions
    }, [onToggleDangerouslySkipPermissions])
    useEffect(() => {
      onToggleForkViewRef.current = onToggleForkView
    }, [onToggleForkView])

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
          onToggleForkView: () => onToggleForkViewRef.current?.(),
        }),
        Placeholder.configure({
          placeholder: placeholder || 'Type something...',
        }),
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
            'data-mention': 'true',
          },
          renderHTML({ node }) {
            return [
              'span',
              {
                class: 'mention',
                'data-mention': node.attrs.id,
                title: `Open ${node.attrs.id}`,
              },
              `@${node.attrs.label || node.attrs.id}`,
            ]
          },
          suggestion: {
            char: '@',
            allowSpaces: true,
            startOfLine: false,
            items: () => {
              // Just return the query as a simple array
              // The actual file searching happens in FileMentionList
              return ['placeholder']
            },
            render: () => {
              let component: ReactRenderer<FileMentionListRef> | null = null
              let popup: HTMLDivElement | null = null

              return {
                onStart: (props: any) => {
                  // Create a portal div for the dropdown with shadcn styling
                  popup = document.createElement('div')
                  popup.className =
                    'z-50 min-w-[20rem] max-w-[30rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
                  document.body.appendChild(popup)

                  component = new ReactRenderer(FileMentionList, {
                    props,
                    editor: props.editor,
                  })

                  if (popup && component) {
                    popup.appendChild(component.element)

                    // Position the dropdown intelligently based on available space
                    const { clientRect } = props
                    if (clientRect) {
                      const rect = typeof clientRect === 'function' ? clientRect() : clientRect
                      if (rect) {
                        popup.style.position = 'fixed'

                        // Handle horizontal positioning
                        const dropdownWidth = 320 // min-w-[20rem]
                        const spaceRight = window.innerWidth - rect.left

                        if (spaceRight < dropdownWidth) {
                          // Not enough space on the right, align to right edge
                          popup.style.right = '10px'
                          popup.style.left = 'auto'
                        } else {
                          popup.style.left = `${rect.left}px`
                          popup.style.right = 'auto'
                        }

                        // Calculate available space above and below
                        const spaceBelow = window.innerHeight - rect.bottom
                        const spaceAbove = rect.top
                        const dropdownHeight = 300 // Approximate height of dropdown

                        // Position above if not enough space below
                        if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
                          popup.style.bottom = `${window.innerHeight - rect.top + 4}px`
                          popup.style.top = 'auto'
                          popup.style.maxHeight = `${Math.min(spaceAbove - 20, 400)}px`
                        } else {
                          popup.style.top = `${rect.bottom + 4}px`
                          popup.style.bottom = 'auto'
                          popup.style.maxHeight = `${Math.min(spaceBelow - 20, 400)}px`
                        }

                        popup.style.overflowY = 'auto'
                      }
                    }
                  }
                },
                onUpdate: (props: any) => {
                  if (component) {
                    component.updateProps(props)

                    // Update position with intelligent placement
                    const { clientRect } = props
                    if (clientRect && popup) {
                      const rect = typeof clientRect === 'function' ? clientRect() : clientRect
                      if (rect) {
                        // Handle horizontal positioning
                        const dropdownWidth = 320
                        const spaceRight = window.innerWidth - rect.left

                        if (spaceRight < dropdownWidth) {
                          popup.style.right = '10px'
                          popup.style.left = 'auto'
                        } else {
                          popup.style.left = `${rect.left}px`
                          popup.style.right = 'auto'
                        }

                        // Recalculate position based on available space
                        const spaceBelow = window.innerHeight - rect.bottom
                        const spaceAbove = rect.top
                        const dropdownHeight = 300

                        if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
                          popup.style.bottom = `${window.innerHeight - rect.top + 4}px`
                          popup.style.top = 'auto'
                          popup.style.maxHeight = `${Math.min(spaceAbove - 20, 400)}px`
                        } else {
                          popup.style.top = `${rect.bottom + 4}px`
                          popup.style.bottom = 'auto'
                          popup.style.maxHeight = `${Math.min(spaceBelow - 20, 400)}px`
                        }
                      }
                    }
                  }
                },
                onKeyDown: (props: any) => {
                  if (props.event.key === 'Escape') {
                    return true
                  }

                  if (component?.ref) {
                    return component.ref.onKeyDown(props)
                  }

                  return false
                },
                onExit: () => {
                  if (popup && popup.parentNode) {
                    popup.parentNode.removeChild(popup)
                  }
                  if (component) {
                    component.destroy()
                  }
                  popup = null
                  component = null
                },
              }
            },
          },
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

    // Handle clicks and hovers on mentions
    useEffect(() => {
      if (!editor) return

      const handleClick = async (event: MouseEvent) => {
        const target = event.target as HTMLElement

        // Check if clicked element is a mention or inside a mention
        const mention = target.closest('.mention') as HTMLElement
        if (mention && mention.dataset.mention) {
          event.preventDefault()
          event.stopPropagation()

          const filePath = mention.dataset.mention
          logger.log('Opening file:', filePath)

          try {
            // Open the file using the default system editor
            await openPath(filePath)
          } catch (error) {
            logger.error('Failed to open file:', error)
          }
        }
      }

      const handleMouseMove = (event: MouseEvent) => {
        const target = event.target as HTMLElement
        const mention = target.closest('.mention') as HTMLElement

        if (mention && mention.dataset.mention) {
          // Get the position of the mention element
          const rect = mention.getBoundingClientRect()
          const filePath = mention.dataset.mention

          setTooltipState({
            open: true,
            content: filePath,
            x: rect.left + rect.width / 2,
            y: rect.top,
          })
        } else if (tooltipState?.open) {
          // Only close if we're not hovering over any mention
          setTooltipState(null)
        }
      }

      const handleMouseLeave = (event: MouseEvent) => {
        // When leaving the editor entirely, close the tooltip
        const relatedTarget = event.relatedTarget as HTMLElement
        if (!relatedTarget || !relatedTarget.closest('.tiptap-editor')) {
          setTooltipState(null)
        }
      }

      // Set up the event handlers once the editor is ready
      const setupEventHandlers = () => {
        try {
          // Check if the editor is destroyed
          if (editor.isDestroyed) return undefined

          // Check if the editor view is available
          if (!editor.view || !editor.view.dom) return undefined

          const editorElement = editor.view.dom
          editorElement.addEventListener('click', handleClick)
          editorElement.addEventListener('mousemove', handleMouseMove)
          editorElement.addEventListener('mouseleave', handleMouseLeave)

          return () => {
            editorElement.removeEventListener('click', handleClick)
            editorElement.removeEventListener('mousemove', handleMouseMove)
            editorElement.removeEventListener('mouseleave', handleMouseLeave)
          }
        } catch {
          // Editor not ready yet, will retry on next update
          return undefined
        }
      }

      // Try to set up immediately
      let cleanup = setupEventHandlers()

      // Also listen for editor updates to retry if needed
      const updateHandler = () => {
        if (!cleanup) {
          cleanup = setupEventHandlers()
        }
      }

      editor.on('update', updateHandler)

      return () => {
        cleanup?.()
        editor.off('update', updateHandler)
      }
    }, [editor, tooltipState])

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
      <>
        <div className="tiptap-wrapper">
          <EditorContent editor={editor} onFocus={onFocus} onBlur={onBlur} />
        </div>

        {/* Controlled tooltip for file mentions */}
        <Tooltip open={tooltipState?.open || false}>
          <TooltipTrigger asChild>
            <div
              ref={virtualAnchor}
              style={{
                position: 'fixed',
                left: tooltipState?.x || 0,
                top: tooltipState?.y || 0,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8} className="max-w-[400px] break-all">
            <div className="flex flex-col gap-1">
              <div className="font-mono text-xs">{tooltipState?.content}</div>
              <div className="text-xs opacity-70">Click to open in default editor</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </>
    )
  },
)

ResponseEditor.displayName = 'ResponseEditor'
