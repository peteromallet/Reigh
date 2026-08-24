import { Film, Scissors, Sparkles } from 'lucide-react';
import { VARIANT_TYPE, type VariantType } from '@/shared/constants/variantTypes';
import type { GenerationVariant } from '@/shared/hooks/variants/useVariants';

const VARIANT_ICON_BY_TYPE: Partial<Record<VariantType, typeof Film>> = {
  [VARIANT_TYPE.TRIMMED]: Scissors,
  [VARIANT_TYPE.UPSCALED]: Sparkles,
  [VARIANT_TYPE.MAGIC_EDIT]: Sparkles,
};

const NON_LOADABLE_VARIANT_TYPES = new Set<VariantType>([
  VARIANT_TYPE.TRIMMED,
  VARIANT_TYPE.CLIP_JOIN,
  VARIANT_TYPE.JOIN_FINAL_STITCH,
]);

type VariantParams = Record<string, unknown>;

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export const getVariantIcon = (variantType: string | null) => {
  if (!variantType) {
    return Film;
  }
  const knownType = Object.values(VARIANT_TYPE).find((type) => type === variantType);
  return (knownType ? VARIANT_ICON_BY_TYPE[knownType] : undefined) ?? Film;
};

export const getVariantLabel = (variant: GenerationVariant): string => {
  if (variant.variant_type === VARIANT_TYPE.TRIMMED) {
    const rawParams = variant.params as VariantParams | null;
    const duration = getFiniteNumber(rawParams?.trimmed_duration);
    return duration !== undefined ? `Trimmed (${duration.toFixed(1)}s)` : 'Trimmed';
  }

  if (variant.variant_type === VARIANT_TYPE.UPSCALED) return 'Upscaled';
  if (variant.variant_type === VARIANT_TYPE.MAGIC_EDIT) return 'Magic Edit';
  if (variant.variant_type === VARIANT_TYPE.ORIGINAL) return 'Original';
  return variant.variant_type || 'Variant';
};

export const isNewVariant = (
  variant: GenerationVariant,
  activeVariantId: string | null
): boolean => {
  if (variant.id === activeVariantId) {
    return false;
  }
  return variant.viewed_at === null;
};

export const getTimeAgo = (createdAt: string): string => {
  const created = new Date(createdAt).getTime();
  const diffMs = Date.now() - created;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
};

export const hasLoadableSettings = (variant: GenerationVariant): boolean => {
  if (variant.variant_type && NON_LOADABLE_VARIANT_TYPES.has(variant.variant_type)) {
    return false;
  }

  const params = variant.params as VariantParams | null;
  if (!params) {
    return false;
  }

  const taskType = (params.task_type || params.created_from) as string | undefined;
  if (taskType === 'video_enhance') {
    return true;
  }

  return !!params.prompt || !!params.orchestrator_details;
};

export type RelationshipFilter = 'all' | 'parents' | 'children' | 'starred';
