import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@humanlayer/ui/lib/utils'

const SHOW_DELAY_MILLISECONDS = 500
const SKIP_DELAY_WINDOW_MILLISECONDS = 300

// Radix shares the skip-delay window only across tooltips under one Provider,
// so each app mounts a single TooltipProvider at its root. This flag lets
// Tooltip detect that root and skip the isolating per-tooltip fallback.
const TooltipProviderMountedContext = React.createContext(false)

function TooltipProvider({
  delayDuration = SHOW_DELAY_MILLISECONDS,
  skipDelayDuration = SKIP_DELAY_WINDOW_MILLISECONDS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderMountedContext.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipProviderMountedContext.Provider>
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = React.useContext(TooltipProviderMountedContext)
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  if (hasProvider) return root
  return <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  arrowClassName,
  portalled = true,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  arrowClassName?: string
  /**
   * Render without the body portal. Needed inside native top-layer surfaces
   * (dialog.showModal) where portaled content paints underneath the dialog.
   */
  portalled?: boolean
}) {
  const content = (
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        'bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
        className,
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className={cn("bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]", arrowClassName)} />
    </TooltipPrimitive.Content>
  )
  if (!portalled) return content
  return <TooltipPrimitive.Portal>{content}</TooltipPrimitive.Portal>
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
