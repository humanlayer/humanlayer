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
            bg-white border-gray-200 text-gray-900
            dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100
            transition-all duration-300
          `,
          
          // Title styles - Sonner default: font-weight: 500, line-height: 1.5
          title: 'font-medium text-sm leading-tight',
          
          // Description styles - Sonner default: font-weight: 400, line-height: 1.4
          description: 'text-sm opacity-90 leading-relaxed mt-1',
          
          // Content wrapper - Sonner default: gap: 2px
          content: 'flex flex-col gap-0.5 flex-1',
          
          // Icon styles - Sonner default: 16x16px
          icon: 'h-4 w-4 flex-shrink-0',
          
          // Loader/spinner styles
          loader: 'h-4 w-4 animate-spin opacity-40',
          
          // Close button - Sonner default: 20x20px, transform: translate(-35%, -35%)
          closeButton: `
            absolute -top-2.5 -left-2.5
            h-5 w-5
            flex items-center justify-center
            rounded-full
            bg-white dark:bg-gray-900
            border border-gray-200 dark:border-gray-800
            text-gray-500 hover:text-gray-900
            dark:text-gray-400 dark:hover:text-gray-100
            hover:bg-gray-50 dark:hover:bg-gray-800
            transition-colors
            cursor-pointer
          `,
          
          // Action button - Sonner default: height: 24px, font-size: 12px, padding: 0 8px
          actionButton: `
            ml-auto flex-shrink-0
            px-2 py-1
            text-xs font-medium
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
            text-xs font-medium
            rounded
            bg-gray-100 text-gray-900
            dark:bg-gray-800 dark:text-gray-100
            hover:bg-gray-200 dark:hover:bg-gray-700
            transition-colors
            cursor-pointer
          `,
          
          // Type-specific styles (replaces richColors)
          // Success - Light: hsl(143, 85%, 96%), Dark: hsl(150, 100%, 6%)
          success: `
            bg-green-50 border-green-200 text-green-900
            dark:bg-green-950 dark:border-green-900 dark:text-green-100
          `,
          
          // Error - Light: hsl(359, 100%, 97%), Dark: hsl(358, 76%, 10%)
          error: `
            bg-red-50 border-red-200 text-red-900
            dark:bg-red-950 dark:border-red-900 dark:text-red-100
          `,
          
          // Warning - Light: hsl(49, 100%, 97%), Dark: hsl(64, 100%, 6%)
          warning: `
            bg-amber-50 border-amber-200 text-amber-900
            dark:bg-amber-950 dark:border-amber-900 dark:text-amber-100
          `,
          
          // Info - Light: hsl(208, 100%, 97%), Dark: hsl(215, 100%, 6%)
          info: `
            bg-blue-50 border-blue-200 text-blue-900
            dark:bg-blue-950 dark:border-blue-900 dark:text-blue-100
          `,
          
          // Loading state
          loading: `
            bg-gray-50 border-gray-200 text-gray-900
            dark:bg-gray-950 dark:border-gray-800 dark:text-gray-100
          `,
          
          // Default/normal toast (when no type specified)
          default: ''
        } 
      }}
      position="bottom-right"
    />
  )
}