import { ToggleGroup, ToggleGroupItem } from "@humanlayer/ui/components/toggle-group"
export type DateRange = '7d' | '30d' | '90d'

interface DateRangeSelectorProps {
  value: DateRange
  onChange: (value: DateRange) => void
  className?: string
}

export function DateRangeSelector({ value, onChange, className }: DateRangeSelectorProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        onChange(v as DateRange)
      }}
      className={className}
    >
      <ToggleGroupItem value="7d" aria-label="Last 7 days">
        7 days
      </ToggleGroupItem>
      <ToggleGroupItem value="30d" aria-label="Last 30 days">
        30 days
      </ToggleGroupItem>
      <ToggleGroupItem value="90d" aria-label="Last 90 days">
        90 days
      </ToggleGroupItem>
    </ToggleGroup>
  )
}