import { useState, useEffect } from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { DirEntry, readDir } from '@tauri-apps/plugin-fs'
import { fuzzySearch } from '@/lib/fuzzy-search'

export interface FileBrowserOptions {
  includeFiles?: boolean
  includeDirectories?: boolean
  fileExtensions?: string[]
  maxResults?: number
}

export interface FileBrowserResult extends DirEntry {
  fullPath: string
  matches?: Array<{ indices: number[]; value?: string; key?: string }>
}

export function useFileBrowser(searchPath: string, options: FileBrowserOptions = {}) {
  const {
    includeFiles = false,
    includeDirectories = true,
    fileExtensions = [],
    maxResults = 10,
  } = options

  const [results, setResults] = useState<FileBrowserResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stabilize the fileExtensions array reference
  const fileExtensionsKey = fileExtensions.join(',')

  useEffect(() => {
    if (!searchPath) {
      setResults([])
      setIsLoading(false)
      setError(null)
      return
    }

    // Debounce the file fetching
    const timeoutId = setTimeout(async () => {
      setIsLoading(true)
      setError(null)

      try {
        let dirPath: string
        let searchQuery: string

        // Special case for just "~" or "/"
        if (searchPath === '~' || searchPath === '/') {
          dirPath = searchPath
          searchQuery = ''
        } else if (searchPath.endsWith('/')) {
          // Path ends with /, means we want to list that directory's contents
          dirPath = searchPath.slice(0, -1) // Remove trailing slash
          searchQuery = ''
        } else {
          // For paths without trailing slash, we need to decide:
          // - If it's a complete directory path (e.g., /Users/name/project)
          // - Or if it's a search query in a parent directory
          
          const lastSlashIndex = searchPath.lastIndexOf('/')
          if (lastSlashIndex === -1) {
            // No slash at all - always treat as search in current directory
            // This ensures we search for patterns like "humanlayer" instead of
            // jumping into a directory that happens to match
            dirPath = '.'
            searchQuery = searchPath
          } else if (lastSlashIndex === 0) {
            // Path like "/something" - could be root directory item or absolute path
            // Treat as listing the directory if it starts with common absolute path prefixes
            dirPath = searchPath
            searchQuery = ''
          } else {
            // Has a slash in middle - check if this looks like a complete directory path
            // vs a search pattern. Directory paths typically start with / or common prefixes
            const looksLikeCompletePath = searchPath.startsWith('/') || 
                                         searchPath.startsWith('./') || 
                                         searchPath.startsWith('../')
            
            if (looksLikeCompletePath && !searchPath.includes('*') && !searchPath.includes('?')) {
              // Looks like a complete directory path, list its contents
              dirPath = searchPath
              searchQuery = ''
            } else {
              // Treat as search pattern - split at last slash
              const pathBeforeSlash = searchPath.substring(0, lastSlashIndex) || '/'
              const pathAfterSlash = searchPath.substring(lastSlashIndex + 1)
              
              if (pathAfterSlash) {
                // There's text after the slash - treat as search in the parent directory
                dirPath = pathBeforeSlash
                searchQuery = pathAfterSlash
              } else {
                // Nothing after slash - list directory contents
                dirPath = pathBeforeSlash
                searchQuery = ''
              }
            }
          }
        }

        // Expand home directory if needed
        if (dirPath === '~' || dirPath.startsWith('~/')) {
          const home = await homeDir()
          dirPath = dirPath === '~' ? home : dirPath.replace('~', home)
        }

        // Read directory contents
        const entries = await readDir(dirPath)

        // Filter entries based on options
        let filtered = entries.filter(entry => {
          if (entry.isDirectory && includeDirectories) return true
          if (entry.isFile && includeFiles) {
            if (fileExtensions.length > 0) {
              return fileExtensions.some(ext => entry.name?.endsWith(ext))
            }
            return true
          }
          return false
        })

        // Apply fuzzy search if there's a search query
        let searchResults: FileBrowserResult[] = []
        if (searchQuery) {
          const fuzzyResults = fuzzySearch(filtered, searchQuery, {
            keys: ['name'],
            threshold: 0.01,
            minMatchCharLength: 1,
            includeMatches: true,
          })

          searchResults = fuzzyResults.slice(0, maxResults).map(result => ({
            ...result.item,
            fullPath: `${dirPath}/${result.item.name}`,
            matches: result.matches,
          }))
        } else {
          searchResults = filtered.slice(0, maxResults).map(entry => ({
            ...entry,
            fullPath: `${dirPath}/${entry.name}`,
          }))
        }

        setResults(searchResults)
      } catch (err) {
        console.error('❌ useFileBrowser: error reading directory:', err)
        setError(err instanceof Error ? err.message : 'Failed to read directory')
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 150)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [searchPath, includeFiles, includeDirectories, fileExtensionsKey, maxResults])

  return { results, isLoading, error }
}
