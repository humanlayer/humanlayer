import type { Meta, StoryObj } from '@storybook/react'
import { Skeleton } from './skeleton'

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Basic skeleton
export const Default: Story = {
  render: () => <Skeleton className="w-32 h-4" />,
}

// Different sizes
export const Small: Story = {
  render: () => <Skeleton className="w-16 h-3" />,
}

export const Medium: Story = {
  render: () => <Skeleton className="w-32 h-4" />,
}

export const Large: Story = {
  render: () => <Skeleton className="w-48 h-6" />,
}

// Different shapes
export const Rectangle: Story = {
  render: () => <Skeleton className="w-32 h-20" />,
}

export const Square: Story = {
  render: () => <Skeleton className="w-16 h-16" />,
}

export const Circle: Story = {
  render: () => <Skeleton className="w-12 h-12 rounded-full" />,
}

export const Avatar: Story = {
  render: () => <Skeleton className="w-10 h-10 rounded-full" />,
}

// Card skeleton
export const Card: Story = {
  render: () => (
    <div className="flex items-center space-x-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  ),
}

// Article skeleton
export const Article: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <Skeleton className="h-6 w-3/4" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-32 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  ),
}

// Profile skeleton
export const Profile: Story = {
  render: () => (
    <div className="space-y-6 w-80">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      {/* Stats */}
      <div className="flex space-x-6">
        <div className="text-center space-y-1">
          <Skeleton className="h-6 w-8 mx-auto" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="text-center space-y-1">
          <Skeleton className="h-6 w-8 mx-auto" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="text-center space-y-1">
          <Skeleton className="h-6 w-8 mx-auto" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
  ),
}

// Table skeleton
export const Table: Story = {
  render: () => (
    <div className="w-96 space-y-3">
      {/* Header */}
      <div className="flex space-x-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Rows */}
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex space-x-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  ),
}

// Dashboard skeleton
export const Dashboard: Story = {
  render: () => (
    <div className="w-96 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-20" />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-18" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      {/* Chart placeholder */}
      <Skeleton className="h-48 w-full" />

      {/* Recent activity */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center space-x-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
}

// List skeleton
export const List: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center space-x-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  ),
}

// Form skeleton
export const Form: Story = {
  render: () => (
    <div className="w-80 space-y-6">
      <Skeleton className="h-8 w-40" />

      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-24 w-full" />
        </div>

        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="flex space-x-3">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-16" />
        </div>
      </div>
    </div>
  ),
}

// Gallery skeleton
export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-4 w-96">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  ),
}

// Chat skeleton
export const Chat: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      {/* Received message */}
      <div className="flex items-start space-x-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-48" />
        </div>
      </div>

      {/* Sent message */}
      <div className="flex items-start space-x-3 flex-row-reverse">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {/* Received message */}
      <div className="flex items-start space-x-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-40" />
        </div>
      </div>

      {/* Typing indicator */}
      <div className="flex items-center space-x-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <div className="flex space-x-1">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-2 w-2 rounded-full" />
        </div>
      </div>
    </div>
  ),
}

// Loading states collection
export const LoadingStates: Story = {
  render: () => (
    <div className="space-y-8 w-96">
      <div>
        <h3 className="text-sm font-medium mb-3">Button Loading</h3>
        <Skeleton className="h-9 w-24" />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Input Loading</h3>
        <Skeleton className="h-10 w-full" />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Text Loading</h3>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Image Loading</h3>
        <Skeleton className="aspect-video w-full" />
      </div>
    </div>
  ),
}

// Custom animation (demonstration)
export const CustomAnimation: Story = {
  render: () => (
    <div className="space-y-4">
      <Skeleton className="h-4 w-32 animate-pulse" />
      <Skeleton
        className="h-4 w-48"
        style={{
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        }}
      />
      <Skeleton className="h-4 w-40" />
    </div>
  ),
}
