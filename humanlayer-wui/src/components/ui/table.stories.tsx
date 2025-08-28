import type { Meta, StoryObj } from '@storybook/react'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'
import { Badge } from './badge'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { MoreHorizontal, ArrowUpDown, Filter } from 'lucide-react'

const meta: Meta<typeof Table> = {
  title: 'UI/Table',
  component: Table,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Basic table
export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>A list of your recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">INV001</TableCell>
          <TableCell>Paid</TableCell>
          <TableCell>Credit Card</TableCell>
          <TableCell className="text-right">$250.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">INV002</TableCell>
          <TableCell>Pending</TableCell>
          <TableCell>PayPal</TableCell>
          <TableCell className="text-right">$150.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">INV003</TableCell>
          <TableCell>Unpaid</TableCell>
          <TableCell>Bank Transfer</TableCell>
          <TableCell className="text-right">$350.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Table with badges
export const WithBadges: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order ID</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">#12345</TableCell>
          <TableCell>John Doe</TableCell>
          <TableCell>
            <Badge variant="default">Completed</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="secondary">Normal</Badge>
          </TableCell>
          <TableCell className="text-right">$299.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">#12346</TableCell>
          <TableCell>Jane Smith</TableCell>
          <TableCell>
            <Badge variant="secondary">Processing</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="destructive">High</Badge>
          </TableCell>
          <TableCell className="text-right">$399.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">#12347</TableCell>
          <TableCell>Mike Johnson</TableCell>
          <TableCell>
            <Badge variant="outline">Pending</Badge>
          </TableCell>
          <TableCell>
            <Badge variant="outline">Low</Badge>
          </TableCell>
          <TableCell className="text-right">$199.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Table with actions
export const WithActions: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">John Doe</TableCell>
          <TableCell>john@example.com</TableCell>
          <TableCell>Admin</TableCell>
          <TableCell>
            <Badge variant="default">Active</Badge>
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Jane Smith</TableCell>
          <TableCell>jane@example.com</TableCell>
          <TableCell>Editor</TableCell>
          <TableCell>
            <Badge variant="default">Active</Badge>
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Mike Johnson</TableCell>
          <TableCell>mike@example.com</TableCell>
          <TableCell>Viewer</TableCell>
          <TableCell>
            <Badge variant="outline">Inactive</Badge>
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Table with checkboxes
export const WithCheckboxes: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]">
            <Checkbox />
          </TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>In Stock</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">MacBook Pro</TableCell>
          <TableCell>Laptops</TableCell>
          <TableCell>$1,999.00</TableCell>
          <TableCell>
            <Badge variant="default">Yes</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">iPhone 15</TableCell>
          <TableCell>Phones</TableCell>
          <TableCell>$999.00</TableCell>
          <TableCell>
            <Badge variant="destructive">No</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Checkbox />
          </TableCell>
          <TableCell className="font-medium">iPad Air</TableCell>
          <TableCell>Tablets</TableCell>
          <TableCell>$599.00</TableCell>
          <TableCell>
            <Badge variant="default">Yes</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Table with footer
export const WithFooter: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Price</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Product A</TableCell>
          <TableCell>2</TableCell>
          <TableCell>$50.00</TableCell>
          <TableCell className="text-right">$100.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Product B</TableCell>
          <TableCell>1</TableCell>
          <TableCell>$75.00</TableCell>
          <TableCell className="text-right">$75.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Product C</TableCell>
          <TableCell>3</TableCell>
          <TableCell>$25.00</TableCell>
          <TableCell className="text-right">$75.00</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right font-medium">$250.00</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}

// Sortable table headers
export const SortableHeaders: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium font-mono uppercase tracking-wider"
            >
              Name
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium font-mono uppercase tracking-wider"
            >
              Date
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium font-mono uppercase tracking-wider"
            >
              Status
              <Filter className="ml-2 h-4 w-4" />
            </Button>
          </TableHead>
          <TableHead className="text-right">
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium font-mono uppercase tracking-wider"
            >
              Amount
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Alice Johnson</TableCell>
          <TableCell>2024-03-15</TableCell>
          <TableCell>
            <Badge variant="default">Complete</Badge>
          </TableCell>
          <TableCell className="text-right">$1,250.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Bob Smith</TableCell>
          <TableCell>2024-03-14</TableCell>
          <TableCell>
            <Badge variant="secondary">Pending</Badge>
          </TableCell>
          <TableCell className="text-right">$750.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Carol Davis</TableCell>
          <TableCell>2024-03-13</TableCell>
          <TableCell>
            <Badge variant="destructive">Failed</Badge>
          </TableCell>
          <TableCell className="text-right">$500.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Dense table
export const Dense: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-8 px-2">ID</TableHead>
          <TableHead className="h-8 px-2">Name</TableHead>
          <TableHead className="h-8 px-2">Type</TableHead>
          <TableHead className="h-8 px-2">Size</TableHead>
          <TableHead className="h-8 px-2">Modified</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 10 }, (_, i) => (
          <TableRow key={i}>
            <TableCell className="py-1 px-2 font-medium">{i + 1}</TableCell>
            <TableCell className="py-1 px-2">file-{i + 1}.txt</TableCell>
            <TableCell className="py-1 px-2">Text File</TableCell>
            <TableCell className="py-1 px-2">{Math.floor(Math.random() * 1000)} KB</TableCell>
            <TableCell className="py-1 px-2">2024-03-{String(15 - i).padStart(2, '0')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

// Empty table
export const EmptyTable: Story = {
  render: () => (
    <Table>
      <TableCaption>No data available.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
            No results found.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Long content table
export const LongContent: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">
            Very Long Title That Might Wrap to Multiple Lines in Some Cases
          </TableCell>
          <TableCell className="max-w-xs">
            This is a very long description that demonstrates how the table handles long content. It
            might wrap to multiple lines depending on the column width and content length.
          </TableCell>
          <TableCell>
            <Badge>Category A</Badge>
          </TableCell>
          <TableCell className="text-right">
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Short Title</TableCell>
          <TableCell>Brief description.</TableCell>
          <TableCell>
            <Badge>Category B</Badge>
          </TableCell>
          <TableCell className="text-right">
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

// Custom styling
export const CustomStyling: Story = {
  render: () => (
    <Table className="border-2 border-accent">
      <TableHeader>
        <TableRow className="bg-muted/50">
          <TableHead className="border-r border-border">Product</TableHead>
          <TableHead className="border-r border-border">Price</TableHead>
          <TableHead className="border-r border-border">Stock</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="hover:bg-accent/5">
          <TableCell className="border-r border-border font-medium">Product 1</TableCell>
          <TableCell className="border-r border-border">$99.99</TableCell>
          <TableCell className="border-r border-border">
            <Badge variant="default">In Stock</Badge>
          </TableCell>
          <TableCell>
            <Button size="sm" variant="outline">
              View
            </Button>
          </TableCell>
        </TableRow>
        <TableRow className="hover:bg-accent/5">
          <TableCell className="border-r border-border font-medium">Product 2</TableCell>
          <TableCell className="border-r border-border">$149.99</TableCell>
          <TableCell className="border-r border-border">
            <Badge variant="destructive">Out of Stock</Badge>
          </TableCell>
          <TableCell>
            <Button size="sm" variant="outline">
              View
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}
