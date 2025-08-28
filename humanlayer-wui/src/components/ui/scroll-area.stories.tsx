import type { Meta, StoryObj } from '@storybook/react'
import { ScrollArea, ScrollBar } from './scroll-area'

const meta: Meta<typeof ScrollArea> = {
  title: 'UI/ScrollArea',
  component: ScrollArea,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Basic vertical scroll
export const Default: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-md border p-4">
      <div className="space-y-3">
        {Array.from({ length: 50 }, (_, i) => (
          <div key={i} className="text-sm">
            Item {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

// Horizontal scroll
export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border">
      <div className="flex w-max space-x-4 p-4">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="shrink-0 w-32 h-20 rounded-md bg-muted flex items-center justify-center text-sm"
          >
            Card {i + 1}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}

// Both directions
export const BothDirections: Story = {
  render: () => (
    <ScrollArea className="h-72 w-96 rounded-md border">
      <div className="p-4 w-max">
        {Array.from({ length: 20 }, (_, row) => (
          <div key={row} className="flex space-x-4 mb-3">
            {Array.from({ length: 10 }, (_, col) => (
              <div
                key={col}
                className="shrink-0 w-24 h-16 rounded-md bg-muted flex items-center justify-center text-sm"
              >
                {row + 1},{col + 1}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}

// Text content
export const TextContent: Story = {
  render: () => (
    <ScrollArea className="h-72 w-80 rounded-md border p-4">
      <h4 className="mb-4 text-sm font-medium leading-none">Lorem Ipsum</h4>
      <div className="text-sm space-y-3">
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
          labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
          laboris nisi ut aliquip ex ea commodo consequat.
        </p>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
          mollit anim id est laborum.
        </p>
        <p>
          Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque
          laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto
          beatae vitae dicta sunt explicabo.
        </p>
        <p>
          Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia
          consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.
        </p>
        <p>
          Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit,
          sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat
          voluptatem.
        </p>
        <p>
          Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi
          ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea
          voluptate velit esse quam nihil molestiae consequatur.
        </p>
      </div>
    </ScrollArea>
  ),
}

// File list
export const FileList: Story = {
  render: () => (
    <ScrollArea className="h-72 w-64 rounded-md border">
      <div className="p-4 space-y-2">
        <h4 className="mb-2 text-sm font-medium leading-none">Files</h4>
        {[
          'components/',
          '  button.tsx',
          '  card.tsx',
          '  input.tsx',
          '  scroll-area.tsx',
          '  select.tsx',
          'hooks/',
          '  use-scroll.ts',
          '  use-theme.ts',
          '  use-local-storage.ts',
          'lib/',
          '  utils.ts',
          '  cn.ts',
          '  constants.ts',
          'pages/',
          '  index.tsx',
          '  about.tsx',
          '  contact.tsx',
          '  settings.tsx',
          'styles/',
          '  globals.css',
          '  components.css',
          'types/',
          '  index.ts',
          '  api.ts',
          'README.md',
          'package.json',
          'tsconfig.json',
          '.gitignore',
        ].map((file, i) => (
          <div
            key={i}
            className={`text-sm px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground cursor-pointer ${
              file.startsWith('  ') ? 'pl-6 text-muted-foreground' : 'font-medium'
            }`}
          >
            {file}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

// Sidebar navigation
export const SidebarNavigation: Story = {
  render: () => (
    <ScrollArea className="h-80 w-56 rounded-md border">
      <div className="p-4 space-y-1">
        <h4 className="mb-2 text-sm font-medium leading-none">Navigation</h4>
        {[
          'Dashboard',
          'Analytics',
          'Projects',
          'Tasks',
          'Calendar',
          'Documents',
          'Settings',
          'Team',
          'Billing',
          'Support',
          'API Keys',
          'Integrations',
          'Webhooks',
          'Audit Log',
          'Security',
          'Notifications',
          'Profile',
          'Preferences',
          'Account',
          'Logout',
        ].map((item, i) => (
          <div
            key={i}
            className="text-sm px-3 py-2 rounded hover:bg-accent hover:text-accent-foreground cursor-pointer"
          >
            {item}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

// Image gallery
export const ImageGallery: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border">
      <div className="flex w-max space-x-4 p-4">
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            className="shrink-0 w-40 h-32 rounded-md bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-medium"
          >
            Photo {i + 1}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}

// Tags/Chips
export const TagsHorizontal: Story = {
  render: () => (
    <ScrollArea className="w-80 whitespace-nowrap rounded-md border">
      <div className="flex w-max space-x-2 p-4">
        {[
          'React',
          'TypeScript',
          'Next.js',
          'Tailwind CSS',
          'Framer Motion',
          'Radix UI',
          'Storybook',
          'Jest',
          'Cypress',
          'Vercel',
          'GitHub',
          'Node.js',
          'Express',
          'PostgreSQL',
          'Prisma',
          'tRPC',
        ].map((tag, i) => (
          <div
            key={i}
            className="inline-flex items-center rounded-md border border-transparent bg-secondary text-secondary-foreground px-3 py-1 text-xs font-medium shrink-0"
          >
            {tag}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}

// Chat messages
export const ChatMessages: Story = {
  render: () => (
    <ScrollArea className="h-80 w-80 rounded-md border">
      <div className="p-4 space-y-3">
        <h4 className="mb-2 text-sm font-medium leading-none">Messages</h4>
        {[
          { user: 'Alice', message: 'Hey everyone! How is the project going?' },
          { user: 'Bob', message: 'Going great! Just finished the user authentication.' },
          { user: 'Carol', message: 'Nice work! I am working on the dashboard now.' },
          { user: 'Alice', message: 'Awesome. Let me know if you need any help.' },
          { user: 'David', message: 'I have some questions about the API endpoints.' },
          { user: 'Bob', message: 'Sure, what do you need to know?' },
          { user: 'David', message: 'Are we using REST or GraphQL?' },
          { user: 'Carol', message: 'We decided to go with REST for simplicity.' },
          { user: 'Alice', message: 'The documentation is in the wiki.' },
          { user: 'David', message: 'Perfect, thanks!' },
          { user: 'Eve', message: 'When is the next team meeting?' },
          { user: 'Bob', message: 'Friday at 3 PM as usual.' },
          { user: 'Eve', message: 'Got it, see you all there!' },
        ].map((msg, i) => (
          <div key={i} className="text-sm">
            <div className="font-medium text-accent">{msg.user}</div>
            <div className="text-muted-foreground mt-1">{msg.message}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

// Code block
export const CodeBlock: Story = {
  render: () => (
    <ScrollArea className="h-72 w-96 rounded-md border bg-muted/50">
      <pre className="p-4 text-xs">
        {`import React from 'react'
import { ScrollArea, ScrollBar } from './scroll-area'

export function CodeExample() {
  return (
    <ScrollArea className="h-72 w-96 rounded-md border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium">
          Scroll Area Example
        </h4>
        <div className="space-y-2">
          {Array.from({ length: 50 }, (_, i) => (
            <div key={i} className="text-sm">
              Item {i + 1}
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

export default CodeExample`}
      </pre>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}

// Small content (no scroll needed)
export const SmallContent: Story = {
  render: () => (
    <ScrollArea className="h-40 w-48 rounded-md border p-4">
      <div className="space-y-2">
        <div className="text-sm">Item 1</div>
        <div className="text-sm">Item 2</div>
        <div className="text-sm">Item 3</div>
      </div>
    </ScrollArea>
  ),
}

// Custom scrollbar styling
export const CustomStyling: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-md border p-4">
      <div className="space-y-3">
        {Array.from({ length: 30 }, (_, i) => (
          <div
            key={i}
            className="text-sm p-2 rounded bg-gradient-to-r from-blue-50 to-indigo-50 border"
          >
            Styled Item {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}
