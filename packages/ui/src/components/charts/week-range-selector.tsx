import { ToggleGroup, ToggleGroupItem } from "@humanlayer/ui/components/toggle-group"

export type WeekRange = 4 | 8 | 12

export const WEEK_RANGES = [4, 8, 12] as const satisfies readonly WeekRange[]

interface WeekRangeSelectorProps {
  value: WeekRange
  onChange: (value: WeekRange) => void
  className?: string
  /**
   * Ranges the caller can honestly render. Omit to offer all of them. A range
   * left out is shown disabled rather than hidden, so the control keeps its
   * shape. Say WHY next to the control, not on it: a disabled toggle takes no
   * pointer events, so a `title` on it can never be read.
   */
  available?: readonly WeekRange[]
  /** id of the element explaining why a range is disabled. */
  describedBy?: string
}

export function WeekRangeSelector({
  value,
  onChange,
  className,
  available = WEEK_RANGES,
  describedBy,
}: WeekRangeSelectorProps) {
  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(v) => v && onChange(Number(v) as WeekRange)}
      className={className}
      aria-describedby={describedBy}
    >
      {WEEK_RANGES.map((range) => (
        <ToggleGroupItem
          key={range}
          value={String(range)}
          aria-label={`Last ${range} weeks`}
          disabled={!available.includes(range)}
        >
          {range} weeks
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
