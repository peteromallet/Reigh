import type { ExtensionPackage } from '@/tools/video-editor/extension';
import type {
  ExtensionCommandContribution,
  ExtensionCommandMenuContext,
} from '@/tools/video-editor/runtime/extensionManifest';

// ---------------------------------------------------------------------------
// Reusable command contribution builders
// ---------------------------------------------------------------------------

export interface CommandFixture {
  id: string;
  title: string;
  description?: string;
  proposal?: boolean;
  keybinding?: { key: string; mac?: string };
  menu?: {
    context: ExtensionCommandMenuContext;
    group?: string;
    order?: number;
  };
}

const makeContribution = (fixture: CommandFixture): ExtensionCommandContribution => ({
  id: fixture.id,
  title: fixture.title,
  description: fixture.description,
  proposal: fixture.proposal,
  keybinding: fixture.keybinding,
  menu: fixture.menu,
});

// ---------------------------------------------------------------------------
// Palette commands — no menu context, visible in command palette only
// ---------------------------------------------------------------------------

export const PALETTE_COMMAND_FIXTURES: CommandFixture[] = [
  {
    id: 'com.example.palette.inspect-clip',
    title: 'Inspect Selected Clip',
    description: 'Open the inspector for the currently selected clip.',
    proposal: false,
    keybinding: { key: 'Ctrl+I', mac: 'Cmd+I' },
  },
  {
    id: 'com.example.palette.export-timeline',
    title: 'Export Timeline Report',
    description: 'Export a JSON report of the current timeline state.',
    proposal: true,
  },
];

// ---------------------------------------------------------------------------
// Clip context-menu commands — appear in right-click menus on clips
// ---------------------------------------------------------------------------

export const CLIP_CONTEXT_MENU_FIXTURES: CommandFixture[] = [
  {
    id: 'com.example.clip.normalize-speed',
    title: 'Normalize Speed',
    description: 'Adjust clip speed to match timeline frame rate.',
    proposal: true,
    menu: { context: 'clip-context', group: 'clip-ops', order: 100 },
  },
  {
    id: 'com.example.clip.add-fade',
    title: 'Add Fade Transition',
    description: 'Apply a crossfade transition at the clip boundary.',
    proposal: true,
    menu: { context: 'clip-context', group: 'clip-ops', order: 110 },
  },
  {
    id: 'com.example.clip.reverse',
    title: 'Reverse Clip',
    description: 'Reverse the playback direction of the selected clip.',
    proposal: true,
    menu: { context: 'clip-context', group: 'clip-ops', order: 120 },
  },
];

// ---------------------------------------------------------------------------
// Keybinding commands — no menu context, executed via keybinding only
// ---------------------------------------------------------------------------

export const KEYBINDING_COMMAND_FIXTURES: CommandFixture[] = [
  {
    id: 'com.example.keybind.quick-render',
    title: 'Quick Render Preview',
    description: 'Render a preview frame at the current playhead position.',
    proposal: false,
    keybinding: { key: 'Ctrl+R', mac: 'Cmd+R' },
  },
  {
    id: 'com.example.keybind.toggle-grid',
    title: 'Toggle Grid Overlay',
    description: 'Toggle the timeline grid overlay on or off.',
    proposal: false,
    keybinding: { key: 'Ctrl+G', mac: 'Cmd+G' },
  },
];

// ---------------------------------------------------------------------------
// Direct commands — non-proposal extension commands (executed immediately)
// ---------------------------------------------------------------------------

export const DIRECT_COMMAND_FIXTURES: CommandFixture[] = [
  {
    id: 'com.example.direct.zoom-fit',
    title: 'Zoom to Fit Timeline',
    description: 'Adjust timeline zoom to fit all clips in view.',
    proposal: false,
    menu: { context: 'timeline-context', group: 'view', order: 50 },
  },
  {
    id: 'com.example.direct.reset-view',
    title: 'Reset Timeline View',
    description: 'Reset zoom and scroll to default timeline view.',
    proposal: false,
    menu: { context: 'canvas-context', group: 'view', order: 60 },
  },
];

// ---------------------------------------------------------------------------
// Proposal commands — require review before committing
// ---------------------------------------------------------------------------

export const PROPOSAL_COMMAND_FIXTURES: CommandFixture[] = [
  {
    id: 'com.example.proposal.auto-color',
    title: 'Auto Color Grade',
    description: 'Apply automatic color grading to selected clips.',
    proposal: true,
    menu: { context: 'clip-selection-context', group: 'color', order: 200 },
    keybinding: { key: 'Ctrl+Shift+C', mac: 'Cmd+Shift+C' },
  },
  {
    id: 'com.example.proposal.stabilize',
    title: 'Stabilize Clip',
    description: 'Apply motion stabilization to the selected video clip.',
    proposal: true,
    menu: { context: 'clip-context', group: 'stabilize', order: 210 },
  },
  {
    id: 'com.example.proposal.denoise',
    title: 'Denoise Audio',
    description: 'Apply audio denoising to the selected audio clip.',
    proposal: true,
    menu: { context: 'track-context', group: 'audio', order: 220 },
  },
];

// ---------------------------------------------------------------------------
// Aggregated fixtures
// ---------------------------------------------------------------------------

export const ALL_COMMAND_FIXTURES: CommandFixture[] = [
  ...PALETTE_COMMAND_FIXTURES,
  ...CLIP_CONTEXT_MENU_FIXTURES,
  ...KEYBINDING_COMMAND_FIXTURES,
  ...DIRECT_COMMAND_FIXTURES,
  ...PROPOSAL_COMMAND_FIXTURES,
];

/** All command fixtures as ExtensionCommandContribution array. */
export const ALL_COMMAND_CONTRIBUTIONS: readonly ExtensionCommandContribution[] =
  ALL_COMMAND_FIXTURES.map(makeContribution);

// ---------------------------------------------------------------------------
// Canonical extension package that carries all command contributions
// ---------------------------------------------------------------------------

export const commandFixturesExtensionPackage: ExtensionPackage = {
  manifest: {
    id: 'com.example.command-fixtures',
    name: 'Command Fixtures Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'An extension fixture carrying commands for palette, context menu, keybinding, direct, and proposal testing.',
    permissions: ['read:timeline', 'write:timeline', 'read:assets'],
    contributions: {
      commands: ALL_COMMAND_CONTRIBUTIONS as unknown as Record<string, unknown>[],
    },
  },
  config: {
    commands: ALL_COMMAND_CONTRIBUTIONS,
  },
};
