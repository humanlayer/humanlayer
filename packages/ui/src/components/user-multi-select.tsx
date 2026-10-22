import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { Button } from './button'
import { Checkbox } from './checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '@humanlayer/ui/lib/utils'

export interface UserOption {
  id: string
  name: string
  /** Optional secondary line (e.g. email) shown under the name to disambiguate identical display names. */
  description?: string
  avatarUrl?: string
  initials?: string
}

interface UserMultiSelectProps {
  users: UserOption[]
  selectedIds: Set<string>
  onSelectionChange: (selectedIds: Set<string>) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  disabled?: boolean
}

export function UserMultiSelect({
  users,
  selectedIds,
  onSelectionChange,
  placeholder = 'Filter by user...',
  searchPlaceholder = 'Search users...',
  emptyMessage = 'No users found',
  className,
  disabled = false,
}: UserMultiSelectProps) {
  const [open, setOpen] = useState(false)

  const toggleUser = (userId: string) => {
    const next = new Set(selectedIds)
    if (next.has(userId)) {
      next.delete(userId)
    } else {
      next.add(userId)
    }
    onSelectionChange(next)
  }

  const clearAll = () => {
    onSelectionChange(new Set())
  }

  const selectedCount = selectedIds.size
  const selectedUsers = users.filter((u) => selectedIds.has(u.id))
  const displayAvatars = selectedUsers.slice(0, 5)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || users.length === 0}
          className={cn(
            'justify-between font-normal h-auto py-1.5 px-3 text-xs uppercase tracking-wider',
            className,
          )}
        >
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <div className="flex -space-x-1">
                {displayAvatars.map((user) =>
                  user.avatarUrl ? (
                    <img
                      key={user.id}
                      src={user.avatarUrl}
                      alt={user.name}
                      className="h-5 w-5 shrink-0 object-cover border border-background"
                    />
                  ) : (
                    <div
                      key={user.id}
                      className="flex h-5 w-5 shrink-0 items-center justify-center bg-muted text-[10px] font-medium border border-background"
                    >
                      {user.initials}
                    </div>
                  ),
                )}
              </div>
            )}
            <span>
              {selectedCount === 0
                ? placeholder
                : selectedCount === 1
                  ? '1 User'
                  : `${selectedCount} Users`}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{users.length === 0 ? 'No users available' : emptyMessage}</CommandEmpty>
            <CommandGroup>
              {users.map((user) => {
                const isSelected = selectedIds.has(user.id)
                return (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    keywords={user.description ? [user.name, user.description] : [user.name]}
                    onSelect={() => toggleUser(user.id)}
                    className="gap-2"
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none [[data-selected=true]_&]:border-accent-foreground data-[state=checked]:[&_svg]:!text-primary-foreground"
                      aria-hidden
                    />
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.name}
                        className="h-5 w-5 shrink-0 object-cover"
                      />
                    ) : user.initials ? (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center bg-muted text-xs font-medium">
                        {user.initials}
                      </div>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{user.name}</span>
                      {user.description ? (
                        <span className="truncate text-xs text-muted-foreground [[data-selected=true]_&]:text-accent-foreground">
                          {user.description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedCount > 0 && (
              <div className="border-t p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={(e) => {
                    e.preventDefault()
                    clearAll()
                  }}
                >
                  Clear all
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
