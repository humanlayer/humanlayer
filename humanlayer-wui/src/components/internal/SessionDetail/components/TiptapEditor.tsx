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

            doc.descendants((node: any, pos: number) => {
              if (node.isText && node.text) {
                const text = node.text

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
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: 'plaintext',
        }),
        MarkdownSyntaxHighlight,
      ],
      content: value,
      editorProps: {
        attributes: {
          class: `tiptap-editor ${className || ''}`,
        },
      },
      onUpdate: ({ editor }) => {
        const text = editor.getText()
        onChange(text)
      },
      editable: !disabled,
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