import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { DiagnosticSeverity } from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Diagnostic severity styling helpers
// ---------------------------------------------------------------------------

export const DIAG_SEVERITY_ICON: Record<DiagnosticSeverity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export const DIAG_SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
};

export const DIAG_SEVERITY_BG: Record<DiagnosticSeverity, string> = {
  error: 'bg-red-500/10 border-red-500/30',
  warning: 'bg-yellow-500/10 border-yellow-500/30',
  info: 'bg-blue-500/10 border-blue-500/30',
};
