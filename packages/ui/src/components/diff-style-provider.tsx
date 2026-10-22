import * as React from 'react'

export type DiffStyle = 'unified' | 'split'

interface DiffStyleContextType {
  diffStyle: DiffStyle
  setDiffStyle: (style: DiffStyle) => void
}

const DiffStyleContext = React.createContext<DiffStyleContextType | undefined>(undefined)

interface DiffStyleProviderProps {
  children: React.ReactNode
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
}

export function DiffStyleProvider({
  children,
  diffStyle,
  onDiffStyleChange,
}: DiffStyleProviderProps) {
  return (
    <DiffStyleContext.Provider value={{ diffStyle, setDiffStyle: onDiffStyleChange }}>
      {children}
    </DiffStyleContext.Provider>
  )
}

export function useDiffStyle(): DiffStyleContextType {
  const context = React.useContext(DiffStyleContext)
  if (context === undefined) {
    return { diffStyle: 'unified', setDiffStyle: () => {} }
  }
  return context
}
