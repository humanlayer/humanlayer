import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'
import { Button } from './button'
import { ChevronDown, ChevronRight, Settings, User, Bell, Shield } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof Collapsible> = {
  title: 'UI/Collapsible',
  component: Collapsible,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    open: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
  },
  args: {
    onOpenChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic collapsible
export const Default: Story = {
  render: args => {
    const [isOpen, setIsOpen] = useState(false)

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-80" {...args}>
        <div className="flex items-center justify-between space-x-4 px-4">
          <h4 className="text-sm font-semibold">@peduarte starred 3 repositories</h4>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-9 p-0">
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <div className="rounded-md border px-4 py-3 font-mono text-sm">@radix-ui/primitives</div>
        <CollapsibleContent className="space-y-2">
          <div className="rounded-md border px-4 py-3 font-mono text-sm">@radix-ui/colors</div>
          <div className="rounded-md border px-4 py-3 font-mono text-sm">@stitches/react</div>
        </CollapsibleContent>
      </Collapsible>
    )
  },
}

// FAQ style
export const FAQ: Story = {
  render: () => {
    const [openItems, setOpenItems] = useState<string[]>([])

    const toggleItem = (item: string) => {
      setOpenItems(prev => (prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]))
    }

    const faqs = [
      {
        id: 'shipping',
        question: 'What are your shipping options?',
        answer:
          'We offer free standard shipping on orders over $50. Express shipping is available for an additional fee. All orders are processed within 1-2 business days.',
      },
      {
        id: 'returns',
        question: 'What is your return policy?',
        answer:
          'Items can be returned within 30 days of purchase in their original condition. We offer free returns for defective items and exchanges for size or color preferences.',
      },
      {
        id: 'warranty',
        question: 'Do you offer warranties?',
        answer:
          'Yes, all products come with a 1-year manufacturer warranty covering defects in materials and workmanship. Extended warranty options are available at checkout.',
      },
    ]

    return (
      <div className="w-96 space-y-2">
        {faqs.map(faq => (
          <Collapsible
            key={faq.id}
            open={openItems.includes(faq.id)}
            onOpenChange={() => toggleItem(faq.id)}
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between p-4 h-auto text-left">
                <span className="font-medium">{faq.question}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${openItems.includes(faq.id) ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4">
              <p className="text-sm text-muted-foreground">{faq.answer}</p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    )
  },
}

// Navigation menu
export const NavigationMenu: Story = {
  render: () => {
    const [openItems, setOpenItems] = useState<string[]>(['account'])

    const toggleItem = (item: string) => {
      setOpenItems(prev => (prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]))
    }

    return (
      <div className="w-64 space-y-1 border rounded-md p-2">
        {/* Account Section */}
        <Collapsible open={openItems.includes('account')} onOpenChange={() => toggleItem('account')}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <User className="mr-2 h-4 w-4" />
              Account
              <ChevronRight
                className={`ml-auto h-4 w-4 transition-transform ${openItems.includes('account') ? 'rotate-90' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-6 space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Profile Settings
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Change Password
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Delete Account
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* Preferences Section */}
        <Collapsible
          open={openItems.includes('preferences')}
          onOpenChange={() => toggleItem('preferences')}
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <Settings className="mr-2 h-4 w-4" />
              Preferences
              <ChevronRight
                className={`ml-auto h-4 w-4 transition-transform ${openItems.includes('preferences') ? 'rotate-90' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-6 space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Theme
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Language
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Timezone
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* Notifications Section */}
        <Collapsible
          open={openItems.includes('notifications')}
          onOpenChange={() => toggleItem('notifications')}
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <Bell className="mr-2 h-4 w-4" />
              Notifications
              <ChevronRight
                className={`ml-auto h-4 w-4 transition-transform ${openItems.includes('notifications') ? 'rotate-90' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-6 space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Email Notifications
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Push Notifications
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              SMS Notifications
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* Security Section */}
        <Collapsible open={openItems.includes('security')} onOpenChange={() => toggleItem('security')}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              <Shield className="mr-2 h-4 w-4" />
              Security
              <ChevronRight
                className={`ml-auto h-4 w-4 transition-transform ${openItems.includes('security') ? 'rotate-90' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-6 space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Two-Factor Auth
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              Active Sessions
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              API Keys
            </Button>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  },
}

// Simple list
export const SimpleList: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false)

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-80">
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            View team members ({isOpen ? 'Hide' : 'Show'})
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          <div className="rounded border p-3">
            <div className="font-medium">John Doe</div>
            <div className="text-sm text-muted-foreground">Frontend Developer</div>
          </div>
          <div className="rounded border p-3">
            <div className="font-medium">Jane Smith</div>
            <div className="text-sm text-muted-foreground">Backend Developer</div>
          </div>
          <div className="rounded border p-3">
            <div className="font-medium">Mike Johnson</div>
            <div className="text-sm text-muted-foreground">Designer</div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  },
}

// Card style
export const CardStyle: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(true)

    return (
      <div className="w-80">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50">
                <div>
                  <h3 className="font-semibold">Project Details</h3>
                  <p className="text-sm text-muted-foreground">
                    Click to {isOpen ? 'collapse' : 'expand'}
                  </p>
                </div>
                <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-3">
                <div>
                  <strong>Status:</strong> In Progress
                </div>
                <div>
                  <strong>Due Date:</strong> March 25, 2024
                </div>
                <div>
                  <strong>Team:</strong> 5 members
                </div>
                <div>
                  <strong>Priority:</strong> High
                </div>
                <div>
                  <strong>Description:</strong> This is a comprehensive project that involves multiple
                  stakeholders and requires careful coordination across different teams.
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    )
  },
}

// Multiple independent
export const MultipleIndependent: Story = {
  render: () => {
    const [openStates, setOpenStates] = useState<Record<string, boolean>>({
      first: false,
      second: true,
      third: false,
    })

    const toggle = (key: string) => {
      setOpenStates(prev => ({
        ...prev,
        [key]: !prev[key],
      }))
    }

    return (
      <div className="w-80 space-y-4">
        <Collapsible open={openStates.first} onOpenChange={() => toggle('first')}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Section 1
              <ChevronDown
                className={`h-4 w-4 transition-transform ${openStates.first ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded border p-4">
            <p className="text-sm">
              This is the content for the first collapsible section. It contains some example text to
              demonstrate the functionality.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={openStates.second} onOpenChange={() => toggle('second')}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Section 2 (Initially Open)
              <ChevronDown
                className={`h-4 w-4 transition-transform ${openStates.second ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded border p-4">
            <p className="text-sm">
              This section starts in an open state. Each collapsible component maintains its own state
              independently.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={openStates.third} onOpenChange={() => toggle('third')}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Section 3
              <ChevronDown
                className={`h-4 w-4 transition-transform ${openStates.third ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded border p-4">
            <p className="text-sm">
              The third section with its own content and state. You can open multiple sections at once.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  },
}

// Disabled state
export const Disabled: Story = {
  render: () => (
    <Collapsible disabled className="w-80">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between" disabled>
          Disabled Collapsible
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded border p-4">
        <p className="text-sm">This content cannot be toggled because the collapsible is disabled.</p>
      </CollapsibleContent>
    </Collapsible>
  ),
}

// Controlled example
export const Controlled: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false)

    return (
      <div className="w-80 space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setIsOpen(true)} disabled={isOpen}>
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsOpen(false)} disabled={!isOpen}>
            Close
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setIsOpen(!isOpen)}>
            Toggle
          </Button>
        </div>

        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Controlled Collapsible
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded border p-4">
            <p className="text-sm">
              This collapsible can be controlled both by clicking the trigger and by using the external
              buttons above.
            </p>
            <p className="text-sm mt-2 text-muted-foreground">
              Current state: {isOpen ? 'Open' : 'Closed'}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  },
}
