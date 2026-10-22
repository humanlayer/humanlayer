import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@humanlayer/ui/lib/utils'

type TabsVariant = 'boxed' | 'underline'

// Lets a caller set the variant once on <TabsList> and have every nested
// <TabsTrigger> pick it up without repeating the prop at each call site.
const TabsVariantContext = React.createContext<TabsVariant>('boxed')

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />
  )
}

const tabsListVariants: Record<TabsVariant, string> = {
  boxed:
    'bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]',
  // Transparent, no box or padding, full row height with items stretched so each
  // trigger's active underline can sit flush with the row's bottom hairline.
  underline:
    'text-muted-foreground inline-flex h-full w-fit items-stretch justify-start gap-1 bg-transparent',
}

function TabsList({
  className,
  variant = 'boxed',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants[variant], className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

const tabsTriggerBase =
  "uppercase tracking-wider focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const tabsTriggerVariants: Record<TabsVariant, string> = {
  boxed:
    'border data-[state=active]:bg-background dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground h-[calc(100%-1px)] flex-1 rounded-md border-transparent px-2 py-1 data-[state=active]:shadow-sm',
  // No box: full height with a 2px bottom accent bar on the active tab that lands
  // on the row's bottom hairline (VS Code / Linear style). Muted when inactive,
  // foreground on hover/active.
  underline:
    'h-full rounded-none border-b-2 border-transparent px-3 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground',
}

function TabsTrigger({
  className,
  variant: variantProp,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: TabsVariant }) {
  const contextVariant = React.useContext(TabsVariantContext)
  const variant = variantProp ?? contextVariant
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(tabsTriggerBase, tabsTriggerVariants[variant], className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
