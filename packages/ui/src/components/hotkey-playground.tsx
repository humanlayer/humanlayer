'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Keycap } from '@humanlayer/ui/components/hotkey-help-modal'
import { cn } from '@humanlayer/ui/lib/utils'

/**
 * Interactive hotkeys-guide playground: a generic ghost of the session page
 * (left nav / conversation stream / artifact viewer) driven by a pure reducer.
 *
 * The frame deliberately ghosts the *shape* of the real layout without cloning
 * its components. When the real layout evolves, update the ghost to match its
 * new shape. Sources of truth for the semantics mirrored here:
 * - layout: apps/riptide-ui/src/routes/_app/sessions/$sessionId.tsx
 * - left nav keys: apps/riptide-ui/src/hooks/useLeftNavHotkeys.ts
 * - stream keys: apps/riptide-ui/src/components/conversation-stream/hooks/useConversationNavigation.ts
 * - artifact keys: packages/ui/src/artifact-viewer-v2/controller/useArtifactController.ts
 * - focus areas: apps/riptide-ui/src/hooks/stores/focusStore.ts
 */

// PLAYGROUND_-prefixed on purpose: playground focus is not app focus.
export type PlaygroundArea = 'PLAYGROUND_LEFT_NAV' | 'PLAYGROUND_MAIN' | 'PLAYGROUND_RIGHT_PANE'

export type PlaygroundState = {
  area: PlaygroundArea
  mainIndex: number
  inputFocused: boolean
  navIndex: number
  expandedNavRow: number | null
  artifactLine: number
  sidebarCollapsed: boolean
  step: number
  /** How many times `r` restarted the tutorial; keys the restart-control blink. */
  restartCount: number
  /** The last key action that actually did something, for the controls light-up. */
  lastAction: PlaygroundActionType | null
  /** Bumps on every effective keypress so a repeat of the same key re-flashes. */
  actionSeq: number
}

export type PlaygroundActionType = PlaygroundAction['type']

export type PlaygroundAction =
  | { type: 'down' }
  | { type: 'up' }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'focusLeft' }
  | { type: 'focusRight' }
  | { type: 'enter' }
  | { type: 'escape' }
  | { type: 'toggleSidebar' }
  | { type: 'restart' }
  // Pristine reset (modal close) — unlike 'restart', it never triggers the blink.
  | { type: 'reset' }

export const PLAYGROUND_MAIN_MESSAGE_COUNT = 8
export const PLAYGROUND_ARTIFACT_LINE_COUNT = 12
const NAV_TOP_ROW_COUNT = 5
const NAV_CHILD_COUNT = 2

export const initialPlaygroundState: PlaygroundState = {
  area: 'PLAYGROUND_MAIN',
  mainIndex: 0,
  inputFocused: false,
  navIndex: 0,
  expandedNavRow: null,
  artifactLine: 0,
  sidebarCollapsed: false,
  step: 0,
  restartCount: 0,
  lastAction: null,
  actionSeq: 0,
}

type NavRowDescriptor = { kind: 'task'; row: number } | { kind: 'session'; parent: number; child: number }

export function visibleNavRows(expandedNavRow: number | null): NavRowDescriptor[] {
  const rows: NavRowDescriptor[] = []
  for (let row = 0; row < NAV_TOP_ROW_COUNT; row++) {
    rows.push({ kind: 'task', row })
    if (row === expandedNavRow) {
      for (let child = 0; child < NAV_CHILD_COUNT; child++) {
        rows.push({ kind: 'session', parent: row, child })
      }
    }
  }
  return rows
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)

function applyAction(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  // A pristine reset (modal close) always applies, even mid-input.
  if (action.type === 'reset') return initialPlaygroundState

  // Mirrors the app's editable guard: while the input owns focus, only escape
  // acts — `r` and friends would just type into a real input.
  if (state.inputFocused) {
    if (action.type === 'escape') return { ...state, inputFocused: false }
    return state
  }

  switch (action.type) {
    case 'focusLeft': {
      if (state.area === 'PLAYGROUND_RIGHT_PANE') return { ...state, area: 'PLAYGROUND_MAIN' }
      if (state.area === 'PLAYGROUND_MAIN') return { ...state, area: 'PLAYGROUND_LEFT_NAV' }
      return state
    }
    case 'focusRight': {
      if (state.area === 'PLAYGROUND_LEFT_NAV') return { ...state, area: 'PLAYGROUND_MAIN' }
      if (state.area === 'PLAYGROUND_MAIN' && !state.sidebarCollapsed) {
        return { ...state, area: 'PLAYGROUND_RIGHT_PANE' }
      }
      return state
    }
    case 'toggleSidebar': {
      const sidebarCollapsed = !state.sidebarCollapsed
      // Opening the sidebar focuses it; closing it drops focus back to MAIN.
      const area = sidebarCollapsed ? 'PLAYGROUND_MAIN' : 'PLAYGROUND_RIGHT_PANE'
      return { ...state, sidebarCollapsed, area }
    }
    case 'down':
    case 'up': {
      const delta = action.type === 'down' ? 1 : -1
      if (state.area === 'PLAYGROUND_MAIN') {
        return { ...state, mainIndex: clamp(state.mainIndex + delta, PLAYGROUND_MAIN_MESSAGE_COUNT - 1) }
      }
      if (state.area === 'PLAYGROUND_LEFT_NAV') {
        const rowCount = visibleNavRows(state.expandedNavRow).length
        return { ...state, navIndex: clamp(state.navIndex + delta, rowCount - 1) }
      }
      return { ...state, artifactLine: clamp(state.artifactLine + delta, PLAYGROUND_ARTIFACT_LINE_COUNT - 1) }
    }
    case 'expand': {
      if (state.area !== 'PLAYGROUND_LEFT_NAV') return state
      const focused = visibleNavRows(state.expandedNavRow)[state.navIndex]
      if (focused?.kind !== 'task' || state.expandedNavRow === focused.row) return state
      // Expanding a different row collapses the previous one, like the task tree.
      const navIndex = visibleNavRows(focused.row).findIndex(
        (row) => row.kind === 'task' && row.row === focused.row,
      )
      return { ...state, expandedNavRow: focused.row, navIndex }
    }
    case 'collapse': {
      if (state.area !== 'PLAYGROUND_LEFT_NAV' || state.expandedNavRow === null) return state
      const focused = visibleNavRows(state.expandedNavRow)[state.navIndex]
      const onExpandedRow = focused?.kind === 'task' && focused.row === state.expandedNavRow
      const onChild = focused?.kind === 'session'
      if (!onExpandedRow && !onChild) return state
      return { ...state, expandedNavRow: null, navIndex: state.expandedNavRow }
    }
    case 'enter': {
      if (state.area === 'PLAYGROUND_MAIN') return { ...state, inputFocused: true }
      return state
    }
    case 'escape': {
      if (state.area !== 'PLAYGROUND_MAIN') return { ...state, area: 'PLAYGROUND_MAIN' }
      return state
    }
    case 'restart':
      return { ...initialPlaygroundState, restartCount: state.restartCount + 1 }
  }
}

/**
 * Whether the playground should swallow Escape instead of letting the dialog
 * close. Only the fake session input traps Escape (it mirrors a real textarea
 * where Escape blurs) — everywhere else Escape closes the guide as usual.
 */
export function playgroundConsumesEscape(state: PlaygroundState): boolean {
  return state.inputFocused
}

export type PlaygroundHintToken = { readonly text: string } | { readonly keys: readonly string[] }

export type PlaygroundStep = {
  readonly hint: readonly PlaygroundHintToken[]
  readonly advances?: (prev: PlaygroundState, next: PlaygroundState, action: PlaygroundAction) => boolean
}

const text = (value: string): PlaygroundHintToken => ({ text: value })
const keys = (...value: string[]): PlaygroundHintToken => ({ keys: value })

const movedIn =
  (area: PlaygroundArea) => (prev: PlaygroundState, _next: PlaygroundState, action: PlaygroundAction) =>
    (action.type === 'down' || action.type === 'up') && prev.area === area && !prev.inputFocused

const enteredArea = (area: PlaygroundArea) => (prev: PlaygroundState, next: PlaygroundState) =>
  prev.area !== area && next.area === area

export const PLAYGROUND_STEPS: readonly PlaygroundStep[] = [
  {
    hint: [text('use'), keys('J'), text('or'), keys('↓'), text('to scroll down')],
    advances: (prev, _next, action) =>
      action.type === 'down' && prev.area === 'PLAYGROUND_MAIN' && !prev.inputFocused,
  },
  {
    hint: [text('use'), keys('K'), text('or'), keys('↑'), text('to scroll up')],
    advances: (prev, _next, action) =>
      action.type === 'up' && prev.area === 'PLAYGROUND_MAIN' && !prev.inputFocused,
  },
  {
    hint: [text('use'), keys('Enter'), text('to focus the session input')],
    advances: (prev, next) => !prev.inputFocused && next.inputFocused,
  },
  {
    hint: [text('use'), keys('Esc'), text('to clear the focus')],
    advances: (prev, next) => prev.inputFocused && !next.inputFocused,
  },
  {
    hint: [keys('J'), text('/'), keys('K'), text('to scroll more')],
    advances: movedIn('PLAYGROUND_MAIN'),
  },
  {
    hint: [text('use'), keys('⇧', 'H'), text('or'), keys('⇧', '←'), text('to focus the left nav')],
    advances: enteredArea('PLAYGROUND_LEFT_NAV'),
  },
  {
    hint: [keys('J'), text('/'), keys('K'), text('to scroll the left nav')],
    advances: movedIn('PLAYGROUND_LEFT_NAV'),
  },
  {
    hint: [keys('L'), text('to expand an item')],
    advances: (prev, next) => prev.expandedNavRow === null && next.expandedNavRow !== null,
  },
  {
    hint: [keys('H'), text('to contract an item')],
    advances: (prev, next) => prev.expandedNavRow !== null && next.expandedNavRow === null,
  },
  {
    hint: [keys('⇧', 'L'), text('or'), keys('⇧', '→'), text('to defocus the left nav')],
    advances: (prev, next) => prev.area === 'PLAYGROUND_LEFT_NAV' && next.area === 'PLAYGROUND_MAIN',
  },
  {
    hint: [keys('⇧', 'L'), text('or'), keys('⇧', '→'), text('to focus the artifact viewer')],
    advances: enteredArea('PLAYGROUND_RIGHT_PANE'),
  },
  {
    hint: [keys('J'), text('/'), keys('K'), text('to scroll the artifact content')],
    advances: movedIn('PLAYGROUND_RIGHT_PANE'),
  },
  {
    hint: [keys('⇧', 'H'), text('to focus the main content')],
    advances: (prev, next) => prev.area === 'PLAYGROUND_RIGHT_PANE' && next.area === 'PLAYGROUND_MAIN',
  },
  {
    hint: [keys('S'), text('to hide the sidebar')],
    advances: (prev, next) => !prev.sidebarCollapsed && next.sidebarCollapsed,
  },
  {
    hint: [keys('S'), text('to bring the sidebar back')],
    advances: (prev, next) => prev.sidebarCollapsed && !next.sidebarCollapsed,
  },
  {
    hint: [
      text("that's it! you can get back to this tutorial at any time with"),
      keys('⇧', '?'),
    ],
  },
]

export function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  // restart/reset return a pristine tutorial and never light a control.
  if (action.type === 'restart' || action.type === 'reset') return applyAction(state, action)
  const next = applyAction(state, action)
  // Swallowed / true no-op (same reference): don't record a keypress.
  if (next === state) return state
  const advanced = PLAYGROUND_STEPS[state.step]?.advances?.(state, next, action)
  return {
    ...next,
    step: advanced ? state.step + 1 : next.step,
    lastAction: action.type,
    actionSeq: state.actionSeq + 1,
  }
}

/**
 * Pure key→action mapping shared by the wired hotkey hook and the Storybook
 * ShellDemo so key semantics stay single-sourced.
 */
export function playgroundActionForKeyEvent(event: {
  key: string
  shiftKey: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}): PlaygroundAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (event.shiftKey) {
    switch (key) {
      case 'h':
      case 'ArrowLeft':
        return { type: 'focusLeft' }
      case 'l':
      case 'ArrowRight':
        return { type: 'focusRight' }
      case 's':
        return { type: 'toggleSidebar' }
      default:
        return null
    }
  }
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'down' }
    case 'k':
    case 'ArrowUp':
      return { type: 'up' }
    case 'l':
    case 'ArrowRight':
      return { type: 'expand' }
    case 'h':
    case 'ArrowLeft':
      return { type: 'collapse' }
    case 'Enter':
      return { type: 'enter' }
    case 'Escape':
      return { type: 'escape' }
    case 's':
      return { type: 'toggleSidebar' }
    case 'r':
      return { type: 'restart' }
    default:
      return null
  }
}

// --- Presentation -----------------------------------------------------------

const NAV_ROW_GHOST_WIDTHS = ['w-16', 'w-20', 'w-14', 'w-24', 'w-16'] as const
const MESSAGE_GHOST_LINES: readonly (readonly string[])[] = [
  ['w-3/4', 'w-1/2'],
  ['w-full', 'w-5/6', 'w-2/3'],
  ['w-2/3'],
  ['w-full', 'w-3/4'],
  ['w-5/6', 'w-1/2', 'w-2/3'],
  ['w-1/2'],
  ['w-full', 'w-2/3'],
  ['w-3/4', 'w-5/6', 'w-1/2'],
]
const ARTIFACT_GHOST_WIDTHS = [
  'w-1/2',
  'w-full',
  'w-11/12',
  'w-4/5',
  'w-2/3',
  'w-full',
  'w-5/6',
  'w-3/4',
  'w-11/12',
  'w-2/3',
  'w-4/5',
  'w-1/2',
] as const

// A stable callback ref: React re-attaches it whenever the focused element
// moves, keeping the focused ghost in view without an effect.
function scrollGhostIntoView(el: HTMLDivElement | null) {
  el?.scrollIntoView({ block: 'nearest' })
}

function GhostBar({ className }: { className?: string }) {
  return <div className={cn('h-2 rounded-sm bg-muted-foreground/20', className)} />
}

function PlaygroundHint({ tokens }: { tokens: readonly PlaygroundHintToken[] }) {
  return (
    <span className="flex animate-pulse flex-wrap items-center justify-center gap-1 text-center text-[11px] text-accent">
      {tokens.map((token, index) =>
        'text' in token ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} className="inline-flex items-center gap-0.5">
            {token.keys.map((key, keyIndex) => (
              <Keycap key={`${key}-${keyIndex}`} size="md">
                {key}
              </Keycap>
            ))}
          </span>
        ),
      )}
    </span>
  )
}

// Which action lights which control, and the sequence that re-fires the flash.
type ControlLight = { active: PlaygroundActionType | null; seq: number }
const KEY_PRESS_FLASH = 'animate-hotkey-key-press'

/** A single D-pad key: the letter next to the arrow it stands in for. */
function DpadKey({ letter, arrow, on, light }: { letter: string; arrow: string; on: PlaygroundActionType; light: ControlLight }) {
  const active = light.active === on
  return (
    <kbd
      key={active ? light.seq : 'idle'}
      className={cn(
        'flex h-9 min-w-11 items-center justify-center gap-1 rounded-none border bg-muted px-2 font-mono',
        active && KEY_PRESS_FLASH,
      )}
    >
      <span className="text-sm leading-none font-medium text-foreground">{letter}</span>
      <span className="text-sm leading-none text-muted-foreground">{arrow}</span>
    </kbd>
  )
}

/** h/j/k/l laid out the way they sit under your right hand. */
function KeyCross({ light }: { light: ControlLight }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <span />
      <DpadKey letter="K" arrow="↑" on="up" light={light} />
      <span />
      <DpadKey letter="H" arrow="←" on="collapse" light={light} />
      <span />
      <DpadKey letter="L" arrow="→" on="expand" light={light} />
      <span />
      <DpadKey letter="J" arrow="↓" on="down" light={light} />
      <span />
    </div>
  )
}

/** ⇧ + a letter, lit as a chord when its focus action fires. */
function ShiftKey({ letter, on, light }: { letter: string; on: PlaygroundActionType; light: ControlLight }) {
  const active = light.active === on
  return (
    <span key={active ? light.seq : 'idle'} className="flex items-center gap-0.5">
      <Keycap size="md" className={cn(active && KEY_PRESS_FLASH)}>
        ⇧
      </Keycap>
      <Keycap size="md" className={cn(active && KEY_PRESS_FLASH)}>
        {letter}
      </Keycap>
    </span>
  )
}

/** A standalone keycap that lights when its action fires. */
function PressKeycap({ label, on, light }: { label: string; on: PlaygroundActionType; light: ControlLight }) {
  const active = light.active === on
  return (
    <Keycap key={active ? light.seq : 'idle'} size="md" className={cn(active && KEY_PRESS_FLASH)}>
      {label}
    </Keycap>
  )
}

const STUB_FRAME = 'flex h-14 items-center gap-1 rounded-sm border border-border/60 bg-background p-1'
const STUB_PANE = 'flex h-full items-center justify-center rounded-xs bg-accent/10'

/** The three panes with the shifted key that jumps focus to each side. */
function FocusStub({ light }: { light: ControlLight }) {
  return (
    <span className={STUB_FRAME}>
      <span className={cn(STUB_PANE, 'w-16')}>
        <ShiftKey letter="H" on="focusLeft" light={light} />
      </span>
      <span className={cn(STUB_PANE, 'w-10 bg-accent/20')} />
      <span className={cn(STUB_PANE, 'w-16')}>
        <ShiftKey letter="L" on="focusRight" light={light} />
      </span>
    </span>
  )
}

/** Same stub, with the key that hides/restores the pane it acts on. */
function SidebarStub({ light }: { light: ControlLight }) {
  return (
    <span className={STUB_FRAME}>
      <span className={cn(STUB_PANE, 'w-4')} />
      <span className={cn(STUB_PANE, 'w-14')} />
      <span className="flex h-full w-12 items-center justify-center rounded-xs border border-dashed border-border">
        <PressKeycap label="S" on="toggleSidebar" light={light} />
      </span>
    </span>
  )
}

function LegendCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-[9px] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  )
}

function LegendDivider() {
  return <span aria-hidden className="h-14 w-px shrink-0 self-center bg-border" />
}

/**
 * Controller-style legend for the playground: movement as a D-pad cross, and
 * the modifier keys shown on a stub of the layout they act on. Keys light up as
 * the matching action fires so pressing a hotkey is visibly acknowledged.
 */
export function PlaygroundControls({ state }: { state: PlaygroundState }) {
  const light: ControlLight = { active: state.lastAction, seq: state.actionSeq }
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 px-2 pt-1 pb-4">
      <LegendCell label="move">
        <KeyCross light={light} />
      </LegendCell>
      <LegendDivider />
      <LegendCell label="focus pane">
        <FocusStub light={light} />
      </LegendCell>
      <LegendDivider />
      <LegendCell label="toggle sidebar">
        <SidebarStub light={light} />
      </LegendCell>
      <LegendDivider />
      <LegendCell label="session input">
        <span className="flex h-14 flex-col justify-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <PressKeycap label="⏎" on="enter" light={light} />
            <span>focus</span>
          </span>
          <span className="flex items-center gap-1.5">
            <PressKeycap label="esc" on="escape" light={light} />
            <span>blur</span>
          </span>
        </span>
      </LegendCell>
    </div>
  )
}

function PlaygroundLeftNav({ state }: { state: PlaygroundState }) {
  const rows = visibleNavRows(state.expandedNavRow)
  return (
    <div
      className={cn(
        'flex w-40 shrink-0 flex-col gap-1 overflow-y-auto p-2 transition-colors',
        state.area === 'PLAYGROUND_LEFT_NAV' && 'bg-accent/20',
      )}
    >
      <GhostBar className="mb-1.5 w-12 opacity-70" />
      {rows.map((row, index) => {
        const focused = state.area === 'PLAYGROUND_LEFT_NAV' && state.navIndex === index
        return (
          <div
            key={row.kind === 'task' ? `task-${row.row}` : `session-${row.parent}-${row.child}`}
            ref={focused ? scrollGhostIntoView : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors',
              row.kind === 'session' && 'ml-3',
              focused ? 'bg-accent/30' : 'bg-accent/10',
            )}
          >
            {row.kind === 'task' &&
              (state.expandedNavRow === row.row ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              ))}
            <GhostBar
              className={row.kind === 'task' ? NAV_ROW_GHOST_WIDTHS[row.row] : 'w-12'}
            />
          </div>
        )
      })}
    </div>
  )
}

function PlaygroundMain({ state }: { state: PlaygroundState }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col transition-colors',
        state.area === 'PLAYGROUND_MAIN' && 'bg-accent/20',
      )}
    >
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {MESSAGE_GHOST_LINES.map((lines, index) => {
          const focused = state.area === 'PLAYGROUND_MAIN' && state.mainIndex === index
          return (
            <div
              key={index}
              ref={focused ? scrollGhostIntoView : undefined}
              className={cn(
                'space-y-1.5 rounded-sm px-2 py-1.5 transition-colors',
                focused ? 'bg-accent/30' : 'bg-accent/10',
              )}
            >
              {lines.map((width, lineIndex) => (
                <GhostBar key={lineIndex} className={width} />
              ))}
            </div>
          )
        })}
      </div>
      <div className="p-2 pt-0">
        <div
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-sm px-2 transition-colors',
            state.inputFocused ? 'bg-accent/30' : 'bg-accent/10',
          )}
        >
          {state.inputFocused && <span className="h-3.5 w-px animate-pulse bg-foreground" />}
          <GhostBar className="w-24 opacity-70" />
        </div>
      </div>
    </div>
  )
}

function PlaygroundArtifactViewer({ state }: { state: PlaygroundState }) {
  return (
    <div
      className={cn(
        'flex w-48 shrink-0 flex-col transition-colors',
        state.area === 'PLAYGROUND_RIGHT_PANE' && 'bg-accent/20',
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <GhostBar className="w-16 opacity-70" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {ARTIFACT_GHOST_WIDTHS.map((width, index) => {
          const focused = state.area === 'PLAYGROUND_RIGHT_PANE' && state.artifactLine === index
          return (
            <div
              key={index}
              ref={focused ? scrollGhostIntoView : undefined}
              className={cn(
                'border-l-2 border-transparent px-2 py-1 transition-colors',
                // Artifact lines are ghost text: focus is the viewer's accent
                // wash + left rail, not the bg-accent/30 item treatment.
                focused && 'border-accent bg-accent/20',
              )}
            >
              <GhostBar className={width} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HotkeyPlaygroundFrame({ state }: { state: PlaygroundState }) {
  return (
    <div className="hidden h-80 flex-col overflow-hidden border bg-background md:flex">
      <div aria-hidden className="flex min-h-0 flex-1">
        <PlaygroundLeftNav state={state} />
        <PlaygroundMain state={state} />
        {!state.sidebarCollapsed && <PlaygroundArtifactViewer state={state} />}
      </div>
      <div className="relative flex min-h-9 items-center justify-center bg-muted/30 py-1.5 pr-20 pl-3">
        <PlaygroundHint tokens={PLAYGROUND_STEPS[state.step]?.hint ?? []} />
        <span
          // Keyed by restartCount so each `r` press replays the one-shot
          // accent blink; kbd text inherits so the keycap blinks too.
          key={state.restartCount}
          className={cn(
            'absolute right-3 flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground [&_kbd]:text-inherit',
            state.restartCount > 0 && 'animate-hotkey-playground-blink',
          )}
        >
          <Keycap>R</Keycap>
          <span>restart</span>
        </span>
      </div>
    </div>
  )
}
