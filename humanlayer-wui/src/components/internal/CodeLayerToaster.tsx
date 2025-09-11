import { Toaster } from 'sonner'

/**
 * CodeLayerToaster - Custom styled toast notifications
 * 
 * Uses Sonner's unstyled mode with comprehensive Tailwind classes
 * to match our design system while maintaining full control over styling.
 */
export function CodeLayerToaster() {
  return (
    <Toaster
      icons={{
        success: null,
        error: null,
        warning: null,
        info: null,
        loading: null,
      }}
      toastOptions={{ 
        unstyled: true,
        classNames: { 
          // Base toast container - Sonner default: padding: 16px, gap: 6px, border-radius: 8px
          toast: `
            relative
            flex items-center gap-1.5
            w-full max-w-[356px]
            pointer-events-auto
            p-4
            rounded-lg
            shadow-lg
            border
            font-mono
            transition-all duration-300
            bg-background
            border-border
            text-foreground
          `,
          
          // Title styles - Sonner default: font-weight: 500, line-height: 1.5
          title: 'font-medium text-sm leading-tight',
          
          // Description styles - Sonner default: font-weight: 400, line-height: 1.4
          description: 'text-sm opacity-90 leading-relaxed mt-1',
          
          // Content wrapper - Sonner default: gap: 2px
          content: 'flex flex-col gap-0.5 flex-1',
          
          // Icon styles - Not used since we disable icons
          // icon: 'h-4 w-4 flex-shrink-0',
          
          // Loader/spinner styles - Not used since we disable icons
          // loader: 'h-4 w-4 animate-spin opacity-40',
          
          // Close button - Sonner default: 20x20px, transform: translate(-35%, -35%)
          closeButton: `
            absolute -top-2.5 -left-2.5
            h-5 w-5
            flex items-center justify-center
            rounded-full
            bg-background
            border border-border
            text-foreground
            hover:bg-muted
            hover:border-muted-foreground
            transition-colors
            cursor-pointer
          `,
          
          // Action button - Sonner default: height: 24px, font-size: 12px, padding: 0 8px
          actionButton: `
            ml-auto flex-shrink-0
            px-2 py-1
            text-xs font-mono font-medium
            rounded
            bg-gray-900 text-white
            dark:bg-white dark:text-gray-900
            hover:opacity-90
            transition-opacity
            cursor-pointer
          `,
          
          // Cancel button - Secondary action
          cancelButton: `
            ml-2 flex-shrink-0
            px-2 py-1
            text-xs font-mono font-medium
            rounded
            bg-gray-100 text-gray-900
            dark:bg-gray-800 dark:text-gray-100
            hover:bg-gray-200 dark:hover:bg-gray-700
            transition-colors
            cursor-pointer
          `,
          
          // Type-specific styles (replaces richColors)
          // Uses theme-aware terminal colors like the rest of the app
          // Important flags needed to override base styles due to class concatenation order
          success: `
            ![background-color:color-mix(in_srgb,var(--terminal-success)_20%,var(--color-background))]
            !border-[var(--terminal-success)] 
            !text-[var(--terminal-success)]
          `,
          
          // Error uses terminal error color with opacity for background
          error: `
            ![background-color:color-mix(in_srgb,var(--terminal-error)_20%,var(--color-background))]
            !border-[var(--terminal-error)] 
            !text-[var(--terminal-error)]
          `,
          
          // Warning uses terminal warning color consistently
          warning: `
            ![background-color:color-mix(in_srgb,var(--terminal-warning)_20%,var(--color-background))]
            !border-[var(--terminal-warning)] 
            !text-[var(--terminal-warning)]
          `,
          
          // Info uses the terminal accent color for consistency
          info: `
            ![background-color:color-mix(in_srgb,var(--terminal-accent)_20%,var(--color-background))]
            !border-[var(--terminal-accent)] 
            !text-[var(--terminal-accent)]
          `,
          
          // Loading state uses muted colors
          loading: `
            bg-muted/50 
            border-muted-foreground/50 
            text-muted-foreground
          `,
          
          // Default/normal toast (when no type specified)
          // Note: Don't add colors here as they override type-specific colors
          default: ''
        } 
      }}
      position="bottom-right"
    />
  )
}