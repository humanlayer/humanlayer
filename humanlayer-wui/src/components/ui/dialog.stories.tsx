import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from './dialog'
import { Button } from './button'
import { Input } from './input'
import { Label } from './label'
import { Textarea } from './textarea'
import { AlertTriangle, Trash2, Settings, User } from 'lucide-react'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    open: {
      control: 'boolean',
    },
  },
  args: {
    onOpenChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic dialog
export const Default: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete your account and remove your data
            from our servers.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive">Delete Account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Simple confirmation dialog
export const Confirmation: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Deletion</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this item? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Form dialog
export const FormDialog: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button>
          <User className="mr-2 h-4 w-4" />
          Edit Profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Make changes to your profile here. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" defaultValue="John Doe" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" defaultValue="@johndoe" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" defaultValue="john@example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              defaultValue="I'm a software developer passionate about creating great user experiences."
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Info dialog with icon
export const InfoDialog: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings className="mr-2 h-4 w-4" />
          About
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Application Settings
          </DialogTitle>
          <DialogDescription>Configure your application preferences and settings.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm">
            <strong>Version:</strong> 1.0.0
          </div>
          <div className="text-sm">
            <strong>Last Updated:</strong> March 15, 2024
          </div>
          <div className="text-sm">
            <strong>License:</strong> MIT
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Warning dialog
export const WarningDialog: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <AlertTriangle className="mr-2 h-4 w-4" />
          Show Warning
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Warning
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes that will be lost if you continue. Are you sure you want to
            proceed?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Go Back</Button>
          </DialogClose>
          <Button variant="destructive">Discard Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Dialog without close button
export const NoCloseButton: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Modal Dialog</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Modal Dialog</DialogTitle>
          <DialogDescription>
            This dialog doesn't have a close button. You must use the action buttons to close it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>OK</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Large content dialog
export const LargeContent: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Open Large Dialog</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Terms and Conditions</DialogTitle>
          <DialogDescription>Please read and accept our terms and conditions.</DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto space-y-4 text-sm">
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
            laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi
            architecto beatae vitae dicta sunt explicabo.
          </p>
          <p>
            Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia
            consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.
          </p>
          <p>
            Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci
            velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam
            quaerat voluptatem.
          </p>
          <p>
            Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam,
            nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea
            voluptate velit esse quam nihil molestiae consequatur.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Decline</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Accept</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Custom styling
export const CustomStyling: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Custom Dialog</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-2 border-accent">
        <DialogHeader>
          <DialogTitle className="text-accent">Custom Styled Dialog</DialogTitle>
          <DialogDescription>This dialog has custom styling applied.</DialogDescription>
        </DialogHeader>
        <div className="p-4 bg-muted rounded">
          <p className="text-sm">Custom content area with background styling.</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Simple message dialog
export const SimpleMessage: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Show Message</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Success!</DialogTitle>
        </DialogHeader>
        <p>Your changes have been saved successfully.</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button>OK</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

// Title only dialog
export const TitleOnly: Story = {
  render: args => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Quick Confirmation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure you want to continue?</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">No</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Yes</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
