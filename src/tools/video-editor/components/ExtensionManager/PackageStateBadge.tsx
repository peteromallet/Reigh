import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle,
  Info,
  ShieldX,
} from 'lucide-react';
import type { PackageState } from '@/tools/video-editor/runtime/extensionLoader';

// ---------------------------------------------------------------------------
// State display helpers
// ---------------------------------------------------------------------------

const PACKAGE_STATE_CONFIG: Record<
  PackageState,
  { label: string; icon: typeof CheckCircle; color: string; bg: string }
> = {
  loaded: {
    label: 'Loaded',
    icon: CheckCircle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  'disabled-by-user': {
    label: 'Disabled',
    icon: Ban,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10 border-zinc-500/30',
  },
  invalid: {
    label: 'Invalid',
    icon: ShieldX,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
  },
  incompatible: {
    label: 'Incompatible',
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/30',
  },
  duplicate: {
    label: 'Duplicate',
    icon: Info,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  'settings-error': {
    label: 'Settings Error',
    icon: AlertCircle,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/30',
  },
  'runtime-error': {
    label: 'Runtime Error',
    icon: AlertCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
  },
};

export function PackageStateBadge({ state }: { state: PackageState }) {
  const config = PACKAGE_STATE_CONFIG[state];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${config.bg} ${config.color}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
