import { useState, useCallback, useEffect } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { isNotFoundError, isUniqueViolationError } from '@/shared/constants/supabaseErrors';
import type { Json } from '@/integrations/supabase/jsonTypes';

/** Narrow a Json value to a record, returning null if not an object */
function asJsonRecord(value: Json | undefined | null): Record<string, Json | undefined> | null {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return null;
}

interface UseShareGenerationResult {
  handleShare: (e: React.MouseEvent | React.TouchEvent) => Promise<void>;
  isCreatingShare: boolean;
  shareCopied: boolean;
  shareSlug: string | null;
}

interface UseShareGenerationOptions {
  /** Pre-existing share slug (e.g. batch-fetched by parent) */
  initialShareSlug?: string;
  /** Called after a new share is successfully created */
  onShareCreated?: (generationId: string, slug: string) => void;
}

/**
 * Sanitize task data before caching in shared_generations
 * Removes potentially sensitive fields from params
 */
function sanitizeTaskDataForSharing(taskData: Record<string, Json | undefined> | null): Record<string, Json | undefined> | null {
  if (!taskData) return null;

  const sanitized = { ...taskData };

  const redactDeep = (value: Json | undefined, depth: number = 0): Json | undefined => {
    if (depth > 6) return null;
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as Json[];
    if (typeof value === 'object') {
      const out: Record<string, Json | undefined> = {};
      for (const [k, v] of Object.entries(value)) {
        // Strip any obviously sensitive keys
        if (/(api[_-]?key|token|secret|password|service_role|authorization|stripe)/i.test(k)) {
          continue;
        }
        out[k] = redactDeep(v, depth + 1);
      }
      return out;
    }
    return value;
  };

  // Remove or sanitize sensitive fields from params
  if (sanitized.params) {
    sanitized.params = redactDeep(sanitized.params);
  }

  // Remove fields that shouldn't be exposed
  delete sanitized.error_message; // Could contain internal details

  return sanitized;
}

function buildShareUrl(slug: string): string {
  return `${window.location.origin}/share/${slug}`;
}

const SHARE_COPIED_RESET_DELAY_MS = 2000;

function markShareCopied(
  setShareCopied: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  setShareCopied(true);
  window.setTimeout(() => setShareCopied(false), SHARE_COPIED_RESET_DELAY_MS);
}

async function copyToClipboardWithFallback(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to textarea copy path below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

async function fetchExistingShareSlug(
  generationId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase().from('shared_generations')
    .select('share_slug')
    .eq('generation_id', generationId)
    .eq('creator_id', userId)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    throw error;
  }

  return data?.share_slug ?? null;
}

interface ShareCachedDataResult {
  generationData: Record<string, Json | undefined>;
  augmentedTaskData: Record<string, Json | undefined> | null;
}

async function fetchShareCachedData(
  generationId: string,
  taskId: string | null | undefined,
  shotId?: string | null,
): Promise<ShareCachedDataResult> {
  const generationResult = shotId
    ? await supabase().from('shot_final_videos')
      .select('id, location, thumbnail_url, type, params, created_at')
      .eq('id', generationId)
      .eq('shot_id', shotId)
      .single()
    : await supabase().from('generations')
      .select('id, location, thumbnail_url, type, params, created_at')
      .eq('id', generationId)
      .single();

  if (generationResult.error || !generationResult.data) {
    throw generationResult.error ?? new Error('Failed to load generation data');
  }

  let taskResultData: Record<string, Json | undefined> | null = null;
  if (taskId) {
    const { data } = await supabase().from('tasks')
      .select('id, task_type, params, status, created_at')
      .eq('id', taskId)
      .single();
    taskResultData = data;
  }

  let augmentedTaskData: Record<string, Json | undefined> | null = taskResultData;

  if (shotId) {
    try {
      const { data: shotData, error: shotError } = await supabase().from('shots')
        .select('id, name, settings')
        .eq('id', shotId)
        .single();

      const { data: shotGenerations, error: genError } = await supabase().from('shot_generations')
        .select(`
          timeline_frame,
          generation:generations!shot_generations_generation_id_generations_id_fk(
            id,
            location,
            thumbnail_url,
            type
          )
        `)
        .eq('shot_id', shotId)
        .order('timeline_frame', { ascending: true });

      if (!shotError && !genError && shotData && shotGenerations) {
        const settingsRecord = asJsonRecord(shotData.settings);
        const travelSettings = asJsonRecord(settingsRecord?.travel_between_images) ?? {};
        const generationMode = travelSettings.generationMode || 'batch';

        const images = shotGenerations
          .filter((sg) => sg.generation?.type === 'image' && sg.generation?.location)
          .map((sg) => ({
            url: sg.generation.location,
            thumbnail_url: sg.generation.thumbnail_url,
            timeline_frame: sg.timeline_frame,
          }));

        augmentedTaskData = {
          ...taskResultData,
          cached_shot_data: {
            shot_id: shotId,
            shot_name: shotData.name,
            generation_mode: generationMode,
            images,
            settings: {
              prompt: travelSettings.batchVideoPrompt || '',
              negative_prompt: travelSettings.negativePrompt || '',
              frames: travelSettings.batchVideoFrames || 38,
              steps: travelSettings.batchVideoSteps || 6,
              motion: travelSettings.amountOfMotion || 50,
              enhance_prompt: travelSettings.enhancePrompt || false,
              phase_config: travelSettings.phaseConfig || null,
              context_frames: travelSettings.contextFrames || 0,
            },
          },
        };
      }
    } catch {
      // Keep share creation resilient when shot-cache enrichment fails.
    }
  }

  return {
    generationData: generationResult.data,
    augmentedTaskData,
  };
}

interface InsertShareWithRetryArgs {
  generationId: string;
  taskId: string | null | undefined;
  shotId?: string | null;
  userId: string;
  generationData: Record<string, Json | undefined>;
  augmentedTaskData: Record<string, Json | undefined> | null;
  generateShareSlug: (length?: number) => string;
}

async function insertShareWithRetry({
  generationId,
  taskId,
  shotId,
  userId,
  generationData,
  augmentedTaskData,
  generateShareSlug,
}: InsertShareWithRetryArgs): Promise<string | null> {
  const maxAttempts = 5;
  let attempts = 0;

  const { data: creatorRow } = await supabase().from('users')
    .select('username, name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  while (attempts < maxAttempts) {
    const candidateSlug = generateShareSlug(10);
    const creator = creatorRow ?? null;
    const normalizedTaskId = typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
    if (!normalizedTaskId) {
      throw new Error('A task is required to share a generation');
    }
    const sharedGenerationInsert = {
      share_slug: candidateSlug,
      task_id: normalizedTaskId,
      generation_id: generationId,
      creator_id: userId,
      creator_username: creator?.username ?? null,
      creator_name: creator?.name ?? null,
      creator_avatar_url: creator?.avatar_url ?? null,
      cached_generation_data: generationData,
      cached_task_data: sanitizeTaskDataForSharing(augmentedTaskData),
      shot_id: shotId || null,
    };

    const { data: newShare, error: insertError } = await supabase().from('shared_generations')
      .insert(sharedGenerationInsert)
      .select('share_slug')
      .single();

    if (!insertError && newShare) {
      return newShare.share_slug;
    }

    if (isUniqueViolationError(insertError)) {
      attempts++;
      continue;
    }

    if (insertError) {
      throw insertError;
    }
  }

  return null;
}

interface CopyShareLinkAndNotifyArgs {
  slug: string;
  successTitle: string;
  successDescription: string;
  fallbackTitle: string;
  fallbackDescription: string;
  setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
}

async function copyShareLinkAndNotify({
  slug,
  successTitle,
  successDescription,
  fallbackTitle,
  fallbackDescription,
  setShareCopied,
}: CopyShareLinkAndNotifyArgs): Promise<void> {
  const copied = await copyToClipboardWithFallback(buildShareUrl(slug));
  if (copied) {
    markShareCopied(setShareCopied);
    toast({ title: successTitle, description: successDescription });
    return;
  }

  toast({ title: fallbackTitle, description: fallbackDescription });
}

/**
 * Hook to handle sharing of generations via unique slug
 *
 * @param generationId - The generation to share
 * @param taskId - The task associated with the generation
 * @param shotId - Optional shot ID for final videos (to fetch input images and settings)
 */
export function useShareGeneration(
  generationId: string | undefined,
  taskId: string | null | undefined,
  shotId?: string | null,
  options?: UseShareGenerationOptions
): UseShareGenerationResult {
  const { initialShareSlug, onShareCreated } = options ?? {};
  const [shareSlug, setShareSlug] = useState<string | null>(initialShareSlug ?? null);
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  // Reset share state when shot/generation changes
  useEffect(() => {
    setShareSlug(initialShareSlug ?? null);
    setShareCopied(false);
  }, [generationId, shotId, initialShareSlug]);

  // Generate a short, URL-friendly random string
  const generateShareSlug = (length: number = 10): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    
    return result;
  };

  const handleShare = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!generationId) {
      toast({
        title: 'Cannot create share',
        description: 'Generation information not available',
        variant: 'destructive',
      });
      return;
    }

    if (shareSlug) {
      await copyShareLinkAndNotify({
        slug: shareSlug,
        successTitle: 'Link copied!',
        successDescription: 'Share link copied to clipboard',
        fallbackTitle: 'Share ready',
        fallbackDescription: 'Click the copy button to copy the link',
        setShareCopied,
      });
      return;
    }

    setIsCreatingShare(true);
    try {
      const { data: sessionData } = await supabase().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user.id;

      if (!accessToken || !userId) {
        toast({
          title: 'Authentication required',
          description: 'Please sign in to create share links',
          variant: 'destructive',
        });
        return;
      }

      const existingSlug = await fetchExistingShareSlug(generationId, userId);
      if (existingSlug) {
        setShareSlug(existingSlug);
        await copyShareLinkAndNotify({
          slug: existingSlug,
          successTitle: 'Link copied!',
          successDescription: 'Existing share link copied to clipboard',
          fallbackTitle: 'Share found',
          fallbackDescription: 'Click the copy button to copy the link',
          setShareCopied,
        });
        return;
      }

      const { generationData, augmentedTaskData } = await fetchShareCachedData(
        generationId,
        taskId,
        shotId,
      );

      const newSlug = await insertShareWithRetry({
        generationId,
        taskId,
        shotId,
        userId,
        generationData,
        augmentedTaskData,
        generateShareSlug,
      });

      if (!newSlug) {
        toast({
          title: 'Share failed',
          description: 'Failed to generate unique link. Please try again.',
          variant: 'destructive',
        });
        return;
      }

      setShareSlug(newSlug);
      onShareCreated?.(generationId, newSlug);

      await copyShareLinkAndNotify({
        slug: newSlug,
        successTitle: 'Share created!',
        successDescription: 'Share link copied to clipboard',
        fallbackTitle: 'Share created',
        fallbackDescription: 'Click the copy button to copy the link',
        setShareCopied,
      });
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'useShareGeneration',
        toastTitle: 'Share failed',
        logData: { message: 'Please try again' },
      });
    } finally {
      setIsCreatingShare(false);
    }
  }, [generationId, onShareCreated, shareSlug, shotId, taskId]);

  return {
    handleShare,
    isCreatingShare,
    shareCopied,
    shareSlug
  };
}
