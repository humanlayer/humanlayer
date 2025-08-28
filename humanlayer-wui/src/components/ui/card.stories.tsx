import type { Meta, StoryObj } from '@storybook/react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from './card'
import { Button } from './button'
import { Badge } from './badge'
import { Input } from './input'
import { Label } from './label'
import { Settings, User, Calendar, MoreVertical, Heart, MessageSquare, Share } from 'lucide-react'

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Basic card
export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>This is a description of the card content.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This is the main content of the card.</p>
      </CardContent>
    </Card>
  ),
}

// Card with footer
export const WithFooter: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Project Status</CardTitle>
        <CardDescription>Current progress and next steps</CardDescription>
      </CardHeader>
      <CardContent>
        <p>
          The project is progressing well. All milestones are on track and the team is performing
          excellently.
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="mr-2">
          Cancel
        </Button>
        <Button>Continue</Button>
      </CardFooter>
    </Card>
  ),
}

// Card with action
export const WithAction: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </CardAction>
        <CardDescription>Manage your account settings and preferences</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Email notifications</span>
            <input type="checkbox" defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">SMS notifications</span>
            <input type="checkbox" />
          </div>
        </div>
      </CardContent>
    </Card>
  ),
}

// Simple card (title only)
export const TitleOnly: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Simple Card</CardTitle>
      </CardHeader>
      <CardContent>
        <p>This card only has a title and content, no description.</p>
      </CardContent>
    </Card>
  ),
}

// Card with form
export const WithForm: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
        <CardDescription>Enter your information to create a new account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input id="name" placeholder="John Doe" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="john@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="Password" />
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Create Account</Button>
      </CardFooter>
    </Card>
  ),
}

// Stats card
export const StatsCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-4 w-4" />
          Total Users
        </CardTitle>
        <CardDescription>Active users in the last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">12,543</div>
        <p className="text-sm text-muted-foreground">+20.1% from last month</p>
      </CardContent>
    </Card>
  ),
}

// Profile card
export const ProfileCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>John Doe</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </CardAction>
        <CardDescription>Software Developer</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">john.doe@example.com</p>
          <p className="text-sm text-muted-foreground">San Francisco, CA</p>
          <div className="flex gap-2 mt-4">
            <Badge>React</Badge>
            <Badge>TypeScript</Badge>
            <Badge>Node.js</Badge>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full">
          View Profile
        </Button>
      </CardFooter>
    </Card>
  ),
}

// Product card
export const ProductCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Premium Plan</CardTitle>
        <CardAction>
          <Badge>Popular</Badge>
        </CardAction>
        <CardDescription>Perfect for growing businesses</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-3xl font-bold">
            $29<span className="text-sm font-normal text-muted-foreground">/month</span>
          </div>
          <ul className="space-y-2 text-sm">
            <li>✓ Unlimited projects</li>
            <li>✓ Advanced analytics</li>
            <li>✓ Priority support</li>
            <li>✓ Custom integrations</li>
          </ul>
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Get Started</Button>
      </CardFooter>
    </Card>
  ),
}

// Article card
export const ArticleCard: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>How to Build Better User Interfaces</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon">
              <Heart className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <Share className="h-4 w-4" />
            </Button>
          </div>
        </CardAction>
        <CardDescription className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          March 15, 2024 • 5 min read
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Learn the fundamental principles of user interface design and how to apply them to create more
          intuitive and engaging user experiences.
        </p>
      </CardContent>
      <CardFooter>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-muted rounded-full"></div>
            <span className="text-sm text-muted-foreground">John Smith</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />
              24
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />8
            </span>
          </div>
        </div>
      </CardFooter>
    </Card>
  ),
}

// Notification card
export const NotificationCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="text-base">New message received</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm">
            Mark as read
          </Button>
        </CardAction>
        <CardDescription>2 minutes ago</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          You have received a new message from Sarah Wilson regarding the project update.
        </p>
      </CardContent>
    </Card>
  ),
}

// Empty state card
export const EmptyState: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>No projects found</CardTitle>
        <CardDescription>You haven't created any projects yet</CardDescription>
      </CardHeader>
      <CardContent className="text-center py-6">
        <div className="w-12 h-12 bg-muted rounded-full mx-auto mb-4 flex items-center justify-center">
          <Calendar className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground mb-4">Get started by creating your first project</p>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Create Project</Button>
      </CardFooter>
    </Card>
  ),
}

// Multiple cards showcase
export const MultipleCards: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>Your current tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">12</div>
          <p className="text-sm text-muted-foreground">3 completed today</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>This month's revenue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">$4,231</div>
          <p className="text-sm text-muted-foreground">+12% from last month</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
          <CardDescription>Active customers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">1,429</div>
          <p className="text-sm text-muted-foreground">+7% from last month</p>
        </CardContent>
      </Card>
    </div>
  ),
}

// Custom styling
export const CustomStyling: Story = {
  render: () => (
    <Card className="w-80 border-2 border-accent">
      <CardHeader className="bg-muted/50">
        <CardTitle className="text-accent">Custom Styled Card</CardTitle>
        <CardDescription>This card has custom styling applied</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Custom border and header background styling.</p>
      </CardContent>
      <CardFooter className="bg-muted/50">
        <Button>Action Button</Button>
      </CardFooter>
    </Card>
  ),
}
