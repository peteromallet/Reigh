import { Paintbrush, Video, Edit, Users, Link2, Film, Clapperboard, type LucideIcon } from 'lucide-react';

import { AppEnv, type AppEnvValue } from '@/types/env';
import { characterAnimateSettings } from '@/tools/character-animate/settings';
import { editImagesSettings } from '@/tools/edit-images/settings';
import { editVideoSettings } from '@/tools/edit-video/settings/editVideoDefaults';
import { imageGenerationSettings } from '@/tools/image-generation/settings';
import { trainingDataHelperSettings } from '@/tools/training-data-helper/settings';
import { videoEditorSettings } from '@/tools/video-editor/settings/videoEditorDefaults';
import { videoTravelSettings } from '@/tools/travel-between-images/settings';

import { joinClipsSettings } from '@/shared/lib/joinClips/defaults';

export interface ToolUIDefinition {
  id: string;
  name: string;
  path: string;
  description: string;
  environments: AppEnvValue[];
  icon: LucideIcon;
  gradient: string;
  accent: string;
  ornament: string;
  badge?: string;
  paneSection?: 'main' | 'assistant';
  visibleInToolsPane?: boolean;
  darkIconColor?: string;
}

export const toolRuntimeManifest: ToolUIDefinition[] = [
  {
    id: imageGenerationSettings.id,
    name: 'Generate Images',
    path: '/tools/image-generation',
    description: 'Structure, LoRAs + prompt control.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Paintbrush,
    gradient: 'from-wes-pink via-wes-lavender to-wes-dusty-blue',
    accent: 'wes-pink',
    ornament: '❋',
    badge: 'Featured',
    paneSection: 'main',
    visibleInToolsPane: true,
    darkIconColor: '#a67d2a',
  },
  {
    id: videoTravelSettings.id,
    name: 'Travel Between Images',
    path: '/tools/travel-between-images',
    description: 'Image anchors with structure + LoRA control!',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Video,
    gradient: 'from-wes-mint via-wes-sage to-wes-dusty-blue',
    accent: 'wes-mint',
    ornament: '◆',
    badge: 'Popular',
    paneSection: 'main',
    visibleInToolsPane: true,
    darkIconColor: '#3d8a62',
  },
  {
    id: characterAnimateSettings.id,
    name: 'Animate Characters',
    path: '/tools/character-animate',
    description: 'Drive motion from reference video.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Users,
    gradient: 'from-wes-sage via-wes-mint to-wes-lavender',
    accent: 'wes-sage',
    ornament: '◉',
    badge: 'New',
    paneSection: 'assistant',
    visibleInToolsPane: true,
    darkIconColor: '#3d8a62',
  },
  {
    id: joinClipsSettings.id,
    name: 'Join Clips',
    path: '/tools/join-clips',
    description: 'AI-generated transitions between clips.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Link2,
    gradient: 'from-wes-dusty-blue via-wes-lavender to-wes-pink',
    accent: 'wes-dusty-blue',
    ornament: '◆',
    badge: 'New',
    paneSection: 'assistant',
    visibleInToolsPane: true,
    darkIconColor: '#4a7099',
  },
  {
    id: videoEditorSettings.id,
    name: 'Video Editor',
    path: '/tools/video-editor',
    description: 'Multi-track timeline + custom effects.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Clapperboard,
    gradient: 'from-emerald-400 via-cyan-400 to-sky-500',
    accent: 'wes-mint',
    ornament: '▣',
    badge: 'New',
    paneSection: 'main',
    visibleInToolsPane: true,
    darkIconColor: '#4fd1c5',
  },
  {
    id: editImagesSettings.id,
    name: 'Edit Images',
    path: '/tools/edit-images',
    description: 'Prompt edits, inpaint, restyle + transforms.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Edit,
    gradient: 'from-wes-yellow via-wes-salmon to-wes-pink',
    accent: 'wes-yellow',
    ornament: '✦',
    badge: 'New',
    paneSection: 'assistant',
    visibleInToolsPane: true,
    darkIconColor: '#a68018',
  },
  {
    id: editVideoSettings.id,
    name: 'Edit Videos',
    path: '/tools/edit-video',
    description: 'Regenerate + fix video segments.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Film,
    gradient: 'from-wes-coral via-wes-salmon to-wes-pink',
    accent: 'wes-coral',
    ornament: '◇',
    badge: 'New',
    paneSection: 'assistant',
    visibleInToolsPane: true,
    darkIconColor: '#e07070',
  },
  {
    id: trainingDataHelperSettings.id,
    name: 'Training Data Helper',
    path: '/tools/training-data-helper',
    description: 'Prepare and segment training data assets.',
    environments: [AppEnv.LOCAL, AppEnv.WEB],
    icon: Film,
    gradient: 'from-wes-lavender via-wes-dusty-blue to-wes-sage',
    accent: 'wes-lavender',
    ornament: '△',
    paneSection: 'assistant',
    visibleInToolsPane: false,
    darkIconColor: '#7d73b6',
  },
];

export const toolsUIManifest: ToolUIDefinition[] = toolRuntimeManifest.filter(
  (tool) => tool.visibleInToolsPane !== false,
);
