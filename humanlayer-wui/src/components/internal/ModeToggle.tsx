import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/providers/ThemeProvider'

export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  const isDark = theme === 'dark'

  const handleClick = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <Button variant="outline" size="icon" className="cursor-pointer" onClick={handleClick}>
      <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
