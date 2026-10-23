'use client'

import { Fragment, type ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'

export type ShortcutKeys =
  | { readonly combination: readonly string[] }
  | { readonly alternatives: readonly (readonly string[])[] }
  | { readonly sequence: readonly string[] }

export type ShortcutDisplay = {
  readonly mac: ShortcutKeys
  readonly nonMac: ShortcutKeys
}

export type HotkeyHelpGroup = {
  label: string
  scope?: string
  shortcuts: readonly {
    label: string
    display: ShortcutDisplay
  }[]
}

export type HotkeyHelpModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: readonly HotkeyHelpGroup[]
  platform: 'mac' | 'nonMac'
  /** Optional slot rendered above the reference list (the interactive playground). */
  children?: ReactNode
  /** Forwarded to Radix; call event.preventDefault() to keep the dialog open. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

const KEYCAP_SIZES = {
  sm: 'min-w-6 px-1.5 py-1 text-[10px]!',
  md: 'min-w-7 px-2 py-1.5 text-xs!',
} as const

export function Keycap({
  children,
  size = 'sm',
  className,
}: {
  children: string
  size?: keyof typeof KEYCAP_SIZES
  className?: string
}) {
  return (
    <KeyboardShortcut
      size="xs"
      className={cn('h-auto justify-center rounded-none', KEYCAP_SIZES[size], className)}
    >
      {children}
    </KeyboardShortcut>
  )
}

function ShortcutKeycaps({ keys }: { keys: ShortcutKeys }) {
  if ('sequence' in keys) return <Keycap>{keys.sequence.join(',')}</Keycap>

  const combinations = 'combination' in keys ? [keys.combination] : keys.alternatives
  return combinations.map((combination, index) => (
    <Fragment key={`${combination.join('-')}-${index}`}>
      {index > 0 && <span className="px-0.5 text-[9px] text-muted-foreground">or</span>}
      {combination.map((key, keyIndex) => (
        <Keycap key={`${key}-${keyIndex}`}>{key}</Keycap>
      ))}
    </Fragment>
  ))
}

export function HotkeyHelpModal({
  open,
  onOpenChange,
  groups,
  platform,
  children,
  onEscapeKeyDown,
}: HotkeyHelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onEscapeKeyDown={onEscapeKeyDown}
        overlayClassName="z-[60]"
        className="z-[60] grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none p-0 sm:max-w-[1200px]"
      >
        <DialogHeader className="gap-1 border-b px-4 py-3 pr-12 text-left">
          <DialogTitle className="text-[15px]">Hotkeys Guide</DialogTitle>
          <DialogDescription className="sr-only">
            A complete keyboard shortcut reference grouped by where shortcuts work.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto p-4">
          {children}
          {children != null && (
            <div className="flex items-baseline gap-2 px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
              <h2>Full reference</h2>
            </div>
          )}
          <div className="columns-1 gap-7 md:columns-2">
            {groups.map((group) => (
              <section key={group.label} className="mb-5 break-inside-avoid">
                <div className="flex items-baseline gap-2 px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
                  <h2>{group.label}</h2>
                  {group.scope && <span className="text-[9px] opacity-70">{group.scope}</span>}
                </div>
                <div className="border-t">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-2 py-1.5 text-xs"
                    >
                      <span>{shortcut.label}</span>
                      <span className="flex items-center justify-end gap-1">
                        <ShortcutKeycaps keys={shortcut.display[platform]} />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex min-h-10 items-center justify-between border-t bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span>Reference only</span>
          <span className="flex items-center gap-1.5">
            <Keycap>Esc</Keycap>
            <span>close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
