/**
 * Versioned fallback registry for task type config.
 * Used only when DB-backed task_types config is unavailable.
 */
export const TASK_TYPE_CONFIG_FALLBACK_VERSION = 1;

interface TaskTypeConfigFallbackEntry {
  isVisible: boolean;
  displayName?: string;
  supportsProgress?: boolean;
  canCancel?: boolean;
  category?: 'generation' | 'processing' | 'orchestration' | 'utility';
  family?: 'travel' | 'join_clips' | 'character_animate';
  /** Wire-era `task_types.content_type`; consumers infer when absent. */
  contentType?: 'image' | 'video';
}

const TASK_TYPE_CONFIG_FALLBACK: Record<string, TaskTypeConfigFallbackEntry> = {
  travel_orchestrator: { isVisible: true, displayName: 'Travel Between Images', supportsProgress: true, category: 'orchestration', family: 'travel' },
  join_clips_orchestrator: { isVisible: true, displayName: 'Join Clips', supportsProgress: true, category: 'orchestration', family: 'join_clips' },
  edit_video_orchestrator: { isVisible: true, displayName: 'Edit Video', supportsProgress: true, category: 'orchestration' },
  animate_character: { isVisible: true, displayName: 'Animate Character', category: 'generation', family: 'character_animate' },
  individual_travel_segment: { isVisible: true, displayName: 'Travel Segment', category: 'generation', family: 'travel' },
  image_inpaint: { isVisible: true, displayName: 'Image Inpaint', category: 'generation', contentType: 'image' },
  annotated_image_edit: { isVisible: true, displayName: 'Annotated Edit', category: 'generation', contentType: 'image' },
  qwen_image: { isVisible: true, displayName: 'Qwen Image', category: 'generation', contentType: 'image' },
  qwen_image_2512: { isVisible: true, displayName: 'Qwen Image 2512', category: 'generation', contentType: 'image' },
  z_image_turbo: { isVisible: true, displayName: 'Z Image Turbo', category: 'generation', contentType: 'image' },
  z_image_turbo_i2i: { isVisible: true, displayName: 'Z Image Img2Img', category: 'generation', contentType: 'image' },
  qwen_image_style: { isVisible: true, displayName: 'Qwen w/ Reference', category: 'generation', contentType: 'image' },
  qwen_image_edit: { isVisible: true, displayName: 'Qwen Image Edit', category: 'generation', contentType: 'image' },
  video_enhance: { isVisible: true, displayName: 'Video Enhance', category: 'processing', contentType: 'video' },
  travel_segment: { isVisible: false, category: 'processing', family: 'travel' },
  travel_stitch: { isVisible: true, displayName: 'Crossfade Join', category: 'processing' },
  single_image: { isVisible: false, category: 'generation' },
  edit_travel_kontext: { isVisible: false, category: 'generation' },
  edit_travel_flux: { isVisible: false, category: 'generation' },
  join_clips_segment: { isVisible: false, category: 'processing', family: 'join_clips' },
  edit_video_segment: { isVisible: false, category: 'processing' },
  wan_2_2_t2i: { isVisible: false, category: 'generation' },
  extract_frame: { isVisible: false, category: 'utility' },
  generate_openpose: { isVisible: false, category: 'utility' },
  rife_interpolate_images: { isVisible: false, category: 'utility' },
  wgp: { isVisible: false, category: 'utility' },
};

export function getTaskTypeConfigFallback(taskType: string): TaskTypeConfigFallbackEntry | undefined {
  return TASK_TYPE_CONFIG_FALLBACK[taskType];
}

export function getTaskTypeFallbackEntries(): Array<[string, TaskTypeConfigFallbackEntry]> {
  return Object.entries(TASK_TYPE_CONFIG_FALLBACK);
}

export function getTaskTypeFamilyFromFallback(
  taskType: string,
): TaskTypeConfigFallbackEntry['family'] | undefined {
  return TASK_TYPE_CONFIG_FALLBACK[taskType]?.family;
}
