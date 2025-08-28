import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command'
import { Button } from './button'
import { useState } from 'react'
import {
  Calendar,
  CreditCard,
  Settings,
  User,
  Mail,
  MessageSquare,
  Plus,
  Search,
  File,
  Folder,
  Home,
  Terminal,
  Calculator,
} from 'lucide-react'

const meta: Meta<typeof Command> = {
  title: 'UI/Command',
  component: Command,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: {
    onSelect: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic command
export const Default: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <Calendar className="mr-2 h-4 w-4" />
            <span>Calendar</span>
          </CommandItem>
          <CommandItem>
            <Mail className="mr-2 h-4 w-4" />
            <span>Search Emails</span>
          </CommandItem>
          <CommandItem>
            <Calculator className="mr-2 h-4 w-4" />
            <span>Calculator</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <User className="mr-2 h-4 w-4" />
            <span>Profile</span>
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Billing</span>
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Command dialog
export const Dialog: Story = {
  render: () => {
    const [open, setOpen] = useState(false)

    return (
      <>
        <div className="text-center">
          <Button variant="outline" onClick={() => setOpen(true)}>
            Open Command Dialog
          </Button>
          <p className="text-sm text-muted-foreground mt-2">Press ⌘K to open</p>
        </div>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={() => setOpen(false)}>
                <Plus className="mr-2 h-4 w-4" />
                <span>New File</span>
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Search className="mr-2 h-4 w-4" />
                <span>Search</span>
                <CommandShortcut>⌘F</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Terminal className="mr-2 h-4 w-4" />
                <span>Open Terminal</span>
                <CommandShortcut>⌘T</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigation">
              <CommandItem onSelect={() => setOpen(false)}>
                <Home className="mr-2 h-4 w-4" />
                <span>Go to Dashboard</span>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <User className="mr-2 h-4 w-4" />
                <span>Go to Profile</span>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Go to Settings</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </>
    )
  },
}

// File explorer command
export const FileExplorer: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-96">
      <CommandInput placeholder="Search files and folders..." />
      <CommandList>
        <CommandEmpty>No files found.</CommandEmpty>
        <CommandGroup heading="Recent Files">
          <CommandItem>
            <File className="mr-2 h-4 w-4" />
            <span>project-plan.md</span>
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <File className="mr-2 h-4 w-4" />
            <span>components.tsx</span>
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <File className="mr-2 h-4 w-4" />
            <span>README.md</span>
            <CommandShortcut>⌘3</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Folders">
          <CommandItem>
            <Folder className="mr-2 h-4 w-4" />
            <span>src/components</span>
          </CommandItem>
          <CommandItem>
            <Folder className="mr-2 h-4 w-4" />
            <span>src/pages</span>
          </CommandItem>
          <CommandItem>
            <Folder className="mr-2 h-4 w-4" />
            <span>public/assets</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem>
            <Plus className="mr-2 h-4 w-4" />
            <span>Create New File</span>
          </CommandItem>
          <CommandItem>
            <Plus className="mr-2 h-4 w-4" />
            <span>Create New Folder</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Without icons
export const WithoutIcons: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Search commands..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        <CommandGroup heading="Commands">
          <CommandItem>
            <span>Copy</span>
            <CommandShortcut>⌘C</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <span>Paste</span>
            <CommandShortcut>⌘V</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <span>Cut</span>
            <CommandShortcut>⌘X</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <span>Select All</span>
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Edit">
          <CommandItem>
            <span>Undo</span>
            <CommandShortcut>⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <span>Redo</span>
            <CommandShortcut>⌘Y</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Long list with scrolling
export const LongList: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Search from many options..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="All Commands">
          {Array.from({ length: 20 }, (_, i) => (
            <CommandItem key={i}>
              <span>Command {i + 1}</span>
              <CommandShortcut>⌘{i + 1}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Multiple groups
export const MultipleGroups: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Search all features..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Communication">
          <CommandItem>
            <Mail className="mr-2 h-4 w-4" />
            <span>Send Email</span>
          </CommandItem>
          <CommandItem>
            <MessageSquare className="mr-2 h-4 w-4" />
            <span>Start Chat</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Productivity">
          <CommandItem>
            <Calendar className="mr-2 h-4 w-4" />
            <span>Schedule Meeting</span>
          </CommandItem>
          <CommandItem>
            <Plus className="mr-2 h-4 w-4" />
            <span>Create Task</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem>
            <User className="mr-2 h-4 w-4" />
            <span>Edit Profile</span>
          </CommandItem>
          <CommandItem>
            <Settings className="mr-2 h-4 w-4" />
            <span>Preferences</span>
          </CommandItem>
          <CommandItem>
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Billing Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Disabled items
export const WithDisabledItems: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Some items disabled..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem>
            <User className="mr-2 h-4 w-4" />
            <span>View Profile</span>
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Settings className="mr-2 h-4 w-4" />
            <span>Admin Settings</span>
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Mail className="mr-2 h-4 w-4" />
            <span>Send Message</span>
            <CommandShortcut>⌘M</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Billing (Premium only)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

// Custom empty state
export const CustomEmpty: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-80">
      <CommandInput placeholder="Search for something that doesn't exist..." />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-6">
            <Search className="h-8 w-8 text-muted-foreground" />
            <p>No results found</p>
            <p className="text-sm text-muted-foreground">Try searching for something else</p>
          </div>
        </CommandEmpty>
      </CommandList>
    </Command>
  ),
}

// Command palette simulation
export const CommandPalette: Story = {
  render: () => {
    const [open, setOpen] = useState(false)

    return (
      <>
        <div className="flex flex-col items-center gap-4">
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="w-80 justify-start text-muted-foreground"
          >
            <Search className="mr-2 h-4 w-4" />
            Search for commands...
            <CommandShortcut className="ml-auto">⌘K</CommandShortcut>
          </Button>
        </div>

        <CommandDialog
          open={open}
          onOpenChange={setOpen}
          title="Command Palette"
          description="Quick access to all features"
        >
          <CommandInput placeholder="What do you want to do?" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Create">
              <CommandItem onSelect={() => setOpen(false)}>
                <Plus className="mr-2 h-4 w-4" />
                <span>New Document</span>
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Folder className="mr-2 h-4 w-4" />
                <span>New Folder</span>
                <CommandShortcut>⇧⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Calendar className="mr-2 h-4 w-4" />
                <span>Schedule Meeting</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => setOpen(false)}>
                <Home className="mr-2 h-4 w-4" />
                <span>Go to Dashboard</span>
                <CommandShortcut>⌘1</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <User className="mr-2 h-4 w-4" />
                <span>Go to Profile</span>
                <CommandShortcut>⌘2</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Mail className="mr-2 h-4 w-4" />
                <span>Go to Messages</span>
                <CommandShortcut>⌘3</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Tools">
              <CommandItem onSelect={() => setOpen(false)}>
                <Calculator className="mr-2 h-4 w-4" />
                <span>Calculator</span>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Terminal className="mr-2 h-4 w-4" />
                <span>Terminal</span>
                <CommandShortcut>⌘T</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                <Search className="mr-2 h-4 w-4" />
                <span>Global Search</span>
                <CommandShortcut>⌘F</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </>
    )
  },
}

// Minimal command
export const Minimal: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md w-64">
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>Not found.</CommandEmpty>
        <CommandGroup>
          <CommandItem>Apple</CommandItem>
          <CommandItem>Banana</CommandItem>
          <CommandItem>Cherry</CommandItem>
          <CommandItem>Date</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
