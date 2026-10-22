import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import type { Content } from '@tiptap/core'
import { RichTextEditor, type SlashCommand } from './rich-text-editor'

const MOCK_COMMANDS: SlashCommand[] = [
  { name: '/help', source: 'global' },
  { name: '/clear', source: 'global' },
  { name: '/research', source: 'local' },
  { name: '/implement', source: 'local' },
  { name: '/cl:create_plan', source: 'bundled' },
  {
    name: '/progress-report',
    source: 'local',
    description: 'Produce a cycle status report from Linear issues and merged pull requests',
  },
  {
    name: '/agent-workbench:brainstorm',
    source: 'local',
    description: '(agent-workbench) Explore an idea with the user before writing any code',
  },
  {
    name: '/agent-workbench:implement-plan',
    source: 'local',
    description: '(agent-workbench) Carry out an approved plan phase by phase',
  },
]

const meta: Meta = {
  title: 'Shell Demos/RichTextEditor',
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj

// Interactive wrapper
const EditorWrapper = ({ initialValue }: { initialValue?: Content | null }) => {
  const [value, setValue] = useState<Content | null>(initialValue || null)
  return (
    <div className="w-[500px]">
      <RichTextEditor
        value={value}
        onChange={setValue}
        placeholder="What would you like to build?"
        slashCommands={MOCK_COMMANDS}
        onSubmit={() => console.log('Submit:', value)}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <EditorWrapper />,
}

export const WithInitialContent: Story = {
  render: () => (
    <EditorWrapper
      initialValue={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Please implement a new feature that adds dark mode support.',
              },
            ],
          },
        ],
      }}
    />
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className="w-[500px]">
      <RichTextEditor
        value={null}
        onChange={() => {}}
        disabled={true}
        placeholder="Editor is disabled"
        slashCommands={MOCK_COMMANDS}
      />
    </div>
  ),
}

export const AutoFocus: Story = {
  render: () => {
    const [value, setValue] = useState<Content | null>(null)
    return (
      <div className="w-[500px]">
        <RichTextEditor
          value={value}
          onChange={setValue}
          autoFocus="end"
          placeholder="This editor is focused on render — start typing"
          slashCommands={MOCK_COMMANDS}
        />
      </div>
    )
  },
}

export const CustomPlaceholder: Story = {
  render: () => {
    const [value, setValue] = useState<Content | null>(null)
    return (
      <div className="w-[500px]">
        <RichTextEditor
          value={value}
          onChange={setValue}
          placeholder="Describe your coding task in detail..."
          slashCommands={MOCK_COMMANDS}
        />
      </div>
    )
  },
}
