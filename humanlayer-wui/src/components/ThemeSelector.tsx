import React, { useState, useEffect, useRef } from 'react'
import { useTheme, type Theme } from '@/contexts/ThemeContext'
import {
  Moon,
  Sun,
  Coffee,
  Cat,
  ScanEye,
  Framer,
  Box,
  Palette,
  Flower2,
  Sunrise,
  MoonStar,
  Building2,
  CloudLightning,
  Heart,
  Terminal,
} from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from './HotkeyPanel'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '../hooks/hotkeys/scopes'
import { useHotkeyUnicodeChars } from '../hooks/useHotkeyUnicodeChars'

const themes: { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Moon },
  { value: 'solarized-light', label: 'Solarized Light', icon: Sun },
  { value: 'cappuccino', label: 'Cappuccino', icon: Coffee },
  { value: 'catppuccin', label: 'Catppuccin', icon: Cat },
  { value: 'high-contrast', label: 'High Contrast', icon: ScanEye },
  { value: 'framer-dark', label: 'Framer Dark', icon: Framer },
  { value: 'framer-light', label: 'Framer Light', icon: Framer },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark', icon: Box },
  { value: 'gruvbox-light', label: 'Gruvbox Light', icon: Box },
  { value: 'monokai', label: 'Monokai', icon: Palette },
  { value: 'rose-pine', label: 'Rosé Pine', icon: Flower2 },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', icon: Sunrise },
  { value: 'rose-pine-moon', label: 'Rosé Pine Moon', icon: MoonStar },
  { value: 'tokyo-night', label: 'Tokyo Night', icon: Building2 },
  { value: 'tokyo-night-storm', label: 'Tokyo Night Storm', icon: CloudLightning },
  { value: 'bubblegum', label: 'Bubblegum', icon: Heart },
  { value: 'l33t', label: 'L33t', icon: Terminal },
  { value: 'vesper', label: 'Vesper', icon: MoonStar },
]

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const unicodeChars = useHotkeyUnicodeChars()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [positionAbove, setPositionAbove] = useState(true)
  const currentTheme = themes.find(t => t.value === theme)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Update selected index when theme changes or dropdown opens
  useEffect(() => {
    const currentIndex = themes.findIndex(t => t.value === theme)
    if (currentIndex !== -1) {
      setSelectedIndex(currentIndex)
    }
  }, [theme, isOpen])

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = themes.length * 32 + 8 // Approximate height (32px per item + padding)
      const spaceAbove = buttonRect.top
      const spaceBelow = window.innerHeight - buttonRect.bottom

      // Position above if there's enough space, otherwise below
      setPositionAbove(spaceAbove >= dropdownHeight && spaceAbove > spaceBelow)
    }
  }, [isOpen])

  // Scroll selected item into view when selectedIndex changes
  useEffect(() => {
    if (isOpen && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  }, [selectedIndex, isOpen])

  // Hotkey to toggle dropdown
  useHotkeys(
    'meta+t, ctrl+t',
    () => {
      setIsOpen(prev => !prev)
    },
    { preventDefault: true },
  )

  // Navigation hotkeys (only when dropdown is open)
  useHotkeys(
    'j, ArrowDown',
    () => {
      if (isOpen) {
        setSelectedIndex(prev => (prev + 1) % themes.length)
      }
    },
    { preventDefault: true, enabled: isOpen, scopes: [HOTKEY_SCOPES.THEME_SELECTOR] },
  )

  useHotkeys(
    'k, ArrowUp',
    () => {
      if (isOpen) {
        setSelectedIndex(prev => (prev - 1 + themes.length) % themes.length)
      }
    },
    { preventDefault: true, enabled: isOpen, scopes: [HOTKEY_SCOPES.THEME_SELECTOR] },
  )

  useHotkeys(
    'enter',
    () => {
      if (isOpen) {
        setTheme(themes[selectedIndex].value)
        setIsOpen(false)
      }
    },
    { preventDefault: true, enabled: isOpen, scopes: [HOTKEY_SCOPES.THEME_SELECTOR] },
  )

  useHotkeys(
    'escape',
    () => {
      if (isOpen) {
        setIsOpen(false)
      }
    },
    { preventDefault: true, enabled: isOpen, scopes: [HOTKEY_SCOPES.THEME_SELECTOR] },
  )

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            onClick={() => setIsOpen(!isOpen)}
            className="px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
          >
            {currentTheme ? <currentTheme.icon className="w-3 h-3" /> : <ScanEye className="w-3 h-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            Theme: {currentTheme?.label || 'Unknown'}{' '}
            <KeyboardShortcut keyString={`${unicodeChars.Mod}+T`} />
          </p>
        </TooltipContent>
      </Tooltip>

      {isOpen && (
        <HotkeyScopeBoundary
          scope={HOTKEY_SCOPES.THEME_SELECTOR}
          isActive={isOpen}
          rootScopeDisabled={true}
          componentName="ThemeSelector"
        >
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <div
              ref={dropdownRef}
              className={`absolute ${positionAbove ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 min-w-48 border border-border bg-background z-20 max-h-64 overflow-y-auto`}
            >
              {themes.map((themeOption, index) => (
                <button
                  key={themeOption.value}
                  ref={el => (itemRefs.current[index] = el)}
                  onClick={() => {
                    setTheme(themeOption.value)
                    setIsOpen(false)
                  }}
                  className={`w-full px-2 py-1.5 text-left text-xs font-mono transition-colors flex items-center gap-2 ${
                    index === selectedIndex
                      ? 'bg-accent/20 text-accent'
                      : theme === themeOption.value
                        ? 'bg-accent/10 text-accent'
                        : 'text-foreground hover:bg-accent/5'
                  }`}
                >
                  <themeOption.icon className="w-3 h-3" />
                  <span>{themeOption.label}</span>
                </button>
              ))}
            </div>
          </>
        </HotkeyScopeBoundary>
      )}
    </div>
  )
}
