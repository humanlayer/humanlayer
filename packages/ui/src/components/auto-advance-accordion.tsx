import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@humanlayer/ui/components/accordion'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { cn } from '@humanlayer/ui/lib/utils'

export interface AutoAdvanceAccordionProps {
  questionsToResearchEnabled: boolean
  onQuestionsToResearchChange: (enabled: boolean) => void
  researchToDesignEnabled: boolean
  onResearchToDesignChange: (enabled: boolean) => void
  defaultOpen?: boolean
  className?: string
}

export function AutoAdvanceAccordion({
  questionsToResearchEnabled,
  onQuestionsToResearchChange,
  researchToDesignEnabled,
  onResearchToDesignChange,
  defaultOpen = false,
  className,
}: AutoAdvanceAccordionProps) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'auto-advance' : undefined}
      className={cn(
        'bg-card text-card-foreground border border-border font-mono',
        className,
      )}
    >
      <AccordionItem value="auto-advance" className="border-b-0">
        <AccordionTrigger className="px-6 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Auto Advance
        </AccordionTrigger>
        <AccordionContent className="px-6">
          <div className="space-y-4 my-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="questions-to-research" className="text-xs font-mono">
                  Questions → Research
                </Label>
                <Switch
                  id="questions-to-research"
                  checked={questionsToResearchEnabled}
                  onCheckedChange={onQuestionsToResearchChange}
                />
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                Automatically launch research when questions session completes
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="research-to-design" className="text-xs font-mono">
                  Research → Design
                </Label>
                <Switch
                  id="research-to-design"
                  checked={researchToDesignEnabled}
                  onCheckedChange={onResearchToDesignChange}
                />
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                Automatically launch design discussion when research session completes
              </p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
