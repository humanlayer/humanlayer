import { SyncGridAnimation } from "../sync-grid-animation"

interface ChartEmptyStateProps {
    text?: string
    subText?: string
    textClassName?: string 
    subtextClassName?: string
}
export function ChartEmptyState({
    textClassName="text-md", 
    subtextClassName = "text-sm mt-2", 
    text='No data available', 
    subText='Please try selecting a different time period'
}: ChartEmptyStateProps) {
    return (
     <div className="w-full space-y-4">
        <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <p className={textClassName}>{text}</p>
          <p className={subtextClassName}>{subText}</p>
        </div>
      </div>
    )
}

interface ChartLoadingStateProps {
    text?: string 
    className?: string
}
export function ChartLoadingState({
    text = 'Crunching numbers...',
    className
}: ChartLoadingStateProps) {

    return (
        <div className="w-full space-y-4">
            <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-4">
                <SyncGridAnimation size="sm" variant="snake" className="text-accent" />
                <div className={className}>{text}</div>
            </div>
        </div>
    )
}