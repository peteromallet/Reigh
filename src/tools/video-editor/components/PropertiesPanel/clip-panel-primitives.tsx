/**
 * Shared vocabulary of the clip inspector: the sentinel select values, the tab
 * grid classes, and the field label. Lives apart from ClipPanel so the panel's
 * own sections (and BulkClipPanel) can use them without importing the panel.
 */

export const NO_EFFECT = '__none__';
export const NO_TRANSITION = '__none__';
export const TAB_COLUMNS_CLASS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
} as const;

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}
