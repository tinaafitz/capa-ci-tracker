import { useSopMappings } from '@/hooks/useSopMappings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Renders SOP reference cards for a given diagnosis pattern.
 * Each card shows the SOP title, section, summary, and an external link.
 * Renders nothing if no SOPs match or if matchedPattern is null.
 */
export function SopReferenceCards({ matchedPattern }) {
  const { sops, loading } = useSopMappings(matchedPattern)

  if (!matchedPattern || loading || sops.length === 0) return null

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Related SOPs
      </span>
      <div className="space-y-2">
        {sops.map((sop) => (
          <div
            key={sop.id}
            className="rounded-md border border-border p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{sop.sop_title}</span>
                  {sop.source_repo && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {sop.source_repo}
                    </Badge>
                  )}
                </div>
                {sop.sop_section && (
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {sop.sop_section}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 h-7 text-xs"
                asChild
              >
                <a
                  href={sop.sop_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {sop.sop_url.includes('github.com')
                    ? 'Open in GitHub'
                    : 'Open in KB'}
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {sop.summary}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
