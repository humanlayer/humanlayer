import React, { createContext, useContext, useState, useEffect } from 'react'

interface ZoomContextType {
  zoomLevel: number
  setZoomLevel: (level: number) => void
  increaseZoom: () => void
  decreaseZoom: () => void
  resetZoom: () => void
}

const ZoomContext = createContext<ZoomContextType | undefined>(undefined)

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0
const ZOOM_STEP = 0.1
const DEFAULT_ZOOM = 1.0

export function ZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const stored = localStorage.getItem('wui-zoom-level')
    return stored ? parseFloat(stored) : DEFAULT_ZOOM
  })

  useEffect(() => {
    localStorage.setItem('wui-zoom-level', zoomLevel.toString())
    document.body.style.zoom = zoomLevel.toString()
  }, [zoomLevel])

  const increaseZoom = () => {
    setZoomLevel(prev => Math.min(MAX_ZOOM, Math.round((prev + ZOOM_STEP) * 10) / 10))
  }

  const decreaseZoom = () => {
    setZoomLevel(prev => Math.max(MIN_ZOOM, Math.round((prev - ZOOM_STEP) * 10) / 10))
  }

  const resetZoom = () => {
    setZoomLevel(DEFAULT_ZOOM)
  }

  return (
    <ZoomContext.Provider value={{ zoomLevel, setZoomLevel, increaseZoom, decreaseZoom, resetZoom }}>
      {children}
    </ZoomContext.Provider>
  )
}

export function useZoom() {
  const context = useContext(ZoomContext)
  if (context === undefined) {
    throw new Error('useZoom must be used within a ZoomProvider')
  }
  return context
}
