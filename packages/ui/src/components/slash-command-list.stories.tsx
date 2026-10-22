import type { Meta, StoryObj } from '@storybook/react'
import { SlashCommandList, type SlashCommand, type SlashCommandListProps } from './slash-command-list'

const MOCK_COMMANDS: SlashCommand[] = [
  { name: '/help', source: 'global' },
  { name: '/clear', source: 'global' },
  { name: '/research', source: 'local' },
  { name: '/implement', source: 'local' },
  { name: '/test', source: 'local' },
  { name: '/cl:research_codebase', source: 'bundled' },
  { name: '/cl:create_plan', source: 'bundled' },
]

const meta: Meta = {
  title: 'UI/SlashCommandList',
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <div className="w-[300px] border rounded-md shadow-lg bg-popover">
      <SlashCommandList
        commands={MOCK_COMMANDS}
        onSelect={(command) => console.log('Selected:', command)}
      />
    </div>
  ),
}

export const Loading: Story = {
  render: () => (
    <div className="w-[300px] border rounded-md shadow-lg bg-popover">
      <SlashCommandList
        commands={[]}
        isLoading={true}
        onSelect={(command) => console.log('Selected:', command)}
      />
    </div>
  ),
}

export const Error: Story = {
  render: () => (
    <div className="w-[300px] border rounded-md shadow-lg bg-popover">
      <SlashCommandList
        commands={[]}
        error="Failed to load commands"
        onSelect={(command) => console.log('Selected:', command)}
      />
    </div>
  ),
}

export const Empty: Story = {
  render: () => (
    <div className="w-[300px] border rounded-md shadow-lg bg-popover">
      <SlashCommandList
        commands={[]}
        onSelect={(command) => console.log('Selected:', command)}
      />
    </div>
  ),
}

export const ManyCommands: Story = {
  render: () => (
    <div className="w-[300px] border rounded-md shadow-lg bg-popover">
      <SlashCommandList
        commands={[
          ...MOCK_COMMANDS,
          { name: '/build', source: 'local' },
          { name: '/deploy', source: 'local' },
          { name: '/lint', source: 'local' },
          { name: '/format', source: 'local' },
          { name: '/migrate', source: 'local' },
          { name: '/seed', source: 'local' },
        ]}
        onSelect={(command) => console.log('Selected:', command)}
      />
    </div>
  ),
}
