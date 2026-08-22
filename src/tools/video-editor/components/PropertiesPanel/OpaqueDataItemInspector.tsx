import type { FrozenDataItem } from '@/tools/video-editor/data/typed/envelope.ts';

/** Longest payload JSON rendered before truncation kicks in. */
const PAYLOAD_JSON_MAX_CHARS = 400;

/**
 * Host fallback inspector for a frozen data item whose `schemaRef` no
 * registered kind claims (or whose kind binds no inspector). Renders the
 * envelope facts plus a truncated payload JSON; the payload itself stays
 * opaque — the host never interprets it.
 */
export function OpaqueDataItemInspector({ item }: { item: FrozenDataItem }) {
  return (
    <div
      data-testid="opaque-data-item-inspector"
      className="rounded-xl border bg-card/80 p-3 text-xs"
    >
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Data item · opaque schema
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">id</dt>
        <dd className="break-all font-mono" data-testid="opaque-data-item-id">{item.id}</dd>
        <dt className="text-muted-foreground">shape</dt>
        <dd data-testid="opaque-data-item-shape">{item.shape}</dd>
        <dt className="text-muted-foreground">schemaRef</dt>
        <dd className="break-all font-mono" data-testid="opaque-data-item-schema-ref">{item.schemaRef}</dd>
        <dt className="text-muted-foreground">extent</dt>
        <dd className="font-mono" data-testid="opaque-data-item-extent">
          {item.extent.end === undefined ? `[${item.extent.start}, ∞)` : `[${item.extent.start}, ${item.extent.end})`}
        </dd>
        <dt className="text-muted-foreground">domain</dt>
        <dd className="font-mono" data-testid="opaque-data-item-domain">{item.domain}</dd>
        <dt className="text-muted-foreground">adapter</dt>
        <dd className="break-all font-mono" data-testid="opaque-data-item-adapter">{item.provenance.adapterId}</dd>
      </dl>
      <pre
        data-testid="opaque-data-item-payload"
        className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono"
      >
        {stringifyTruncatedPayload(item.payload)}
      </pre>
    </div>
  );
}

function stringifyTruncatedPayload(payload: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2) ?? String(payload);
  } catch {
    // Cyclic or otherwise non-serializable payloads stay opaque, never throw.
    json = String(payload);
  }
  return json.length > PAYLOAD_JSON_MAX_CHARS
    ? `${json.slice(0, PAYLOAD_JSON_MAX_CHARS)}…`
    : json;
}
