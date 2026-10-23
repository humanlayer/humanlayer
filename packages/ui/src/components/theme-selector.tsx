import * as React from 'react'
import {
  Box,
  Building2,
  Cat,
  Crosshair,
  CloudLightning,
  Flower2,
  Framer,
  Gauge,
  Heart,
  Moon,
  MoonStar,
  RadioTower,
  Palette,
  ScanEye,
  Shield,
  Snowflake,
  Sun,
  Sunrise,
  Terminal,
  Zap,
} from 'lucide-react'

function SentryGlyph({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 44" className={className} aria-hidden="true">
      <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z" fill="currentColor" />
    </svg>
  )
}
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useTheme, type Theme } from './theme-provider'
import { cn } from '@humanlayer/ui/lib/utils'
import { KeyboardShortcut } from './keyboard-shortcut'
import { vscodeThemes } from '@humanlayer/ui/vscode-themes.generated'

const manualThemes: { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Moon },
  { value: 'solarized-light', label: 'Solarized Light', icon: Sun },
  { value: 'bubblegum', label: 'Bubblegum', icon: Heart },
  { value: 'sentry', label: 'Sentry', icon: SentryGlyph },
  { value: 'catppuccin', label: 'Catppuccin', icon: Cat },
  { value: 'high-contrast', label: 'High Contrast', icon: ScanEye },
  { value: 'framer-dark', label: 'Framer Dark', icon: Framer },
  { value: 'framer-light', label: 'Framer Light', icon: Framer },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark', icon: Box },
  { value: 'gruvbox-light', label: 'Gruvbox Light', icon: Box },
  { value: 'monokai', label: 'Monokai', icon: Terminal },
  { value: 'launch', label: 'Launch', icon: CloudLightning },
  { value: 'rose-pine', label: 'Rosé Pine', icon: Flower2 },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', icon: Sunrise },
  { value: 'rose-pine-moon', label: 'Rosé Pine Moon', icon: MoonStar },
  { value: 'tokyo-night', label: 'Tokyo Night', icon: Building2 },
  { value: 'tokyo-night-storm', label: 'Tokyo Night Storm', icon: CloudLightning },
  { value: 'vesper', label: 'Vesper', icon: Palette },
  { value: 'rapture', label: 'Rapture', icon: Zap },
  { value: 'tactical', label: 'Tactical', icon: Crosshair },
  { value: 'neuromancer', label: 'Neuromancer', icon: RadioTower },
  { value: 'red-alert', label: 'Red Alert', icon: Shield },
  { value: 'covenant', label: 'Covenant', icon: Shield },
  { value: 'wintermute', label: 'Wintermute', icon: Snowflake },
  { value: 'dash', label: 'Dash', icon: Gauge },
  { value: 'wednesday', label: 'Wednesday', icon: Cat },
]

// Map VS Code themes to match the manual theme structure
const vscodeThemesMapped = vscodeThemes.map(t => ({
  value: t.value as Theme,
  label: t.label,
  icon: t.icon === 'Sun' ? Sun : Moon
}))

const retroThemeValues = new Set<Theme>([
  'covenant',
  'neuromancer',
  'rapture',
  'red-alert',
  'tactical',
  'wintermute',
])

const sortedThemes = [...manualThemes, ...vscodeThemesMapped].sort((a, b) =>
  a.label.localeCompare(b.label)
)
const mainThemes = sortedThemes.filter((theme) => !retroThemeValues.has(theme.value))
const retroThemes = sortedThemes.filter((theme) => retroThemeValues.has(theme.value))
const themes = [...mainThemes, ...retroThemes]
const themeSections = [
  { label: null, themes: mainThemes },
  { label: 'Retro', themes: retroThemes },
]
const themeIndexByValue = new Map(themes.map((theme, index) => [theme.value, index]))

interface ThemeSelectorProps {
  className?: string
  enableHotkeys?: boolean
  hotkeyScope?: string
  showTooltip?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ThemeSelector({
  className,
  enableHotkeys = false,
  hotkeyScope,
  showTooltip = true,
  onOpenChange,
}: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme()
  const [isOpen, setIsOpenState] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [positionAbove, setPositionAbove] = React.useState(false)

  const setIsOpen = React.useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setIsOpenState((prev) => {
      const newState = typeof open === 'function' ? open(prev) : open
      onOpenChange?.(newState)
      return newState
    })
  }, [onOpenChange])

  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const currentTheme = themes.find((t) => t.value === theme) || themes[0]
  const Icon = currentTheme?.icon ?? Sun

  // Calculate dropdown position
  React.useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const dropdownHeight = 400 // Approximate height

      setPositionAbove(spaceBelow < dropdownHeight && spaceAbove > spaceBelow)
    }
  }, [isOpen])

  // Scroll selected item into view
  React.useEffect(() => {
    if (isOpen && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  }, [selectedIndex, isOpen])

  // Hotkeys - always call hooks, but conditionally enable them
  useHotkeys(
    'alt+t',
    (e) => {
      e.preventDefault()
      setIsOpen((prev) => !prev)
      if (!isOpen) {
        setSelectedIndex(themes.findIndex((t) => t.value === theme))
      }
    },
    {
      enableOnFormTags: false,
      enabled: enableHotkeys
    }
  )

  useHotkeys(
    'j, ArrowDown',
    (e) => {
      e.preventDefault()
      setSelectedIndex((prev) => {
        const next = (prev + 1) % themes.length
        return next
      })
    },
    {
      enableOnFormTags: false,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
      enabled: enableHotkeys && isOpen
    }
  )

  useHotkeys(
    'k, ArrowUp',
    (e) => {
      e.preventDefault()
      setSelectedIndex((prev) => {
        const next = (prev - 1 + themes.length) % themes.length
        return next
      })
    },
    {
      enableOnFormTags: false,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
      enabled: enableHotkeys && isOpen
    }
  )

  useHotkeys(
    'enter',
    (e) => {
      e.preventDefault()
      const selectedTheme = themes[selectedIndex]
      if (selectedTheme) {
        setTheme(selectedTheme.value)
        setIsOpen(false)
      }
    },
    {
      enableOnFormTags: false,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
      enabled: enableHotkeys && isOpen
    }
  )

  useHotkeys(
    'escape',
    (e) => {
      e.preventDefault()
      setIsOpen(false)
    },
    {
      enableOnFormTags: false,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
      enabled: enableHotkeys && isOpen
    }
  )

  const button = (
    <button
      ref={buttonRef}
      onClick={() => {
        setIsOpen(!isOpen)
        if (!isOpen) {
          setSelectedIndex(themes.findIndex((t) => t.value === theme))
        }
      }}
      className={cn(
        'px-1.5 py-0.5 text-xs font-mono border border-border',
        'bg-background text-foreground hover:bg-accent/10 transition-colors',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        className
      )}
      aria-label="Select theme"
    >
      <Icon className="w-3 h-3" />
    </button>
  )

  return (
    <div className="relative">
      {showTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>Theme: {currentTheme?.label}</p>
            {enableHotkeys && <KeyboardShortcut>{'⌥+T'}</KeyboardShortcut>}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div
            ref={dropdownRef}
            className={cn(
              'absolute right-0 z-20 min-w-48 border border-border bg-background',
              positionAbove ? 'bottom-full mb-1' : 'top-full mt-1'
            )}
          >
            <div className="max-h-64 overflow-y-auto">
              {themeSections.map((section) => (
                <React.Fragment key={section.label ?? 'main'}>
                  {section.label && (
                    <div
                      role="heading"
                      aria-level={2}
                      className="border-t border-border px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
                    >
                      {section.label}
                    </div>
                  )}
                  {section.themes.map((themeOption) => {
                    const index = themeIndexByValue.get(themeOption.value) ?? 0
                    const ThemeIcon = themeOption.icon
                    const isSelected = theme === themeOption.value
                    const isHighlighted = index === selectedIndex

                    return (
                      <button
                        key={themeOption.value}
                        ref={(el) => {
                          itemRefs.current[index] = el
                        }}
                        onClick={() => {
                          setTheme(themeOption.value)
                          setIsOpen(false)
                        }}
                        onMouseEnter={() => {
                          setSelectedIndex(index)
                        }}
                        className={`w-full px-2 py-1.5 text-left text-xs font-mono transition-colors flex items-center gap-2 ${
                          isHighlighted
                            ? 'bg-accent/20 text-accent'
                            : isSelected
                              ? 'bg-accent/10 text-accent'
                              : 'text-foreground hover:bg-accent/5'
                        }`}
                      >
                        <ThemeIcon className="w-3 h-3" />
                        <span>{themeOption.label}</span>
                      </button>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
