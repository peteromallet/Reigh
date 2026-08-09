import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card.tsx';

/**
 * Takes the timeline region's place when the timeline failed to load. A load
 * failure happens before the first render, so no error boundary can catch it —
 * this is the only thing standing between a malformed backend payload and a
 * blank editor whose badge claims `saved`.
 */
export function TimelineLoadErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
      <Card className="w-full max-w-md" role="alert">
        <CardHeader>
          <CardTitle className="text-base">Unable to load this timeline</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The editor kept its toolbar so you can switch timelines, but there is
            nothing to edit until the timeline loads.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 gap-1.5"
            onClick={onRetry}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
