import type { Meta, StoryObj } from '@storybook/react'
import { TodoWidget, type Todo, type TodoWidgetProps } from './todo-widget'

const MOCK_TODOS: Todo[] = [
  { id: '1', content: 'Research existing implementation', status: 'completed' },
  { id: '2', content: 'Extract EventIcon component', status: 'completed' },
  { id: '3', content: 'Create TodoWidget pure component', status: 'in_progress' },
  { id: '4', content: 'Extract VerticalMinimap', status: 'pending' },
  { id: '5', content: 'Create SidebarWidget wrapper', status: 'pending' },
]

const meta = {
  title: 'UI/TodoWidget',
  component: TodoWidget as any,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[300px] h-[400px] border rounded-lg p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<TodoWidgetProps>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    todos: MOCK_TODOS,
  },
}

export const Empty: Story = {
  args: {
    todos: [],
  },
}

export const AllCompleted: Story = {
  args: {
    todos: [
      { id: '1', content: 'First task', status: 'completed' },
      { id: '2', content: 'Second task', status: 'completed' },
      { id: '3', content: 'Third task', status: 'completed' },
    ],
  },
}

export const AllPending: Story = {
  args: {
    todos: [
      { id: '1', content: 'First task', status: 'pending' },
      { id: '2', content: 'Second task', status: 'pending' },
      { id: '3', content: 'Third task', status: 'pending' },
    ],
  },
}

export const LongContent: Story = {
  args: {
    todos: [
      {
        id: '1',
        content: 'This is a very long todo item that should wrap to multiple lines and demonstrate how the component handles overflow text content gracefully',
        status: 'in_progress',
      },
      { id: '2', content: 'Short task', status: 'pending' },
    ],
  },
}

export const ManyTodos: Story = {
  args: {
    todos: Array.from({ length: 15 }, (_, i) => ({
      id: String(i + 1),
      content: `Task ${i + 1}: Do something important`,
      status: i < 5 ? 'completed' : i < 8 ? 'in_progress' : 'pending',
    })) as Todo[],
  },
}
