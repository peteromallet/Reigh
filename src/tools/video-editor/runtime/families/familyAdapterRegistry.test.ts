/**
 * Family adapter registry tests.
 *
 * @module families/familyAdapterRegistry.test
 */

import { describe, it, expect } from 'vitest';

import {
  VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY,
  VIDEO_EDITOR_FAMILY_ADAPTER_KINDS,
} from './familyAdapterRegistry';

import { slotAdapter } from './slotAdapter';
import { parserAdapter } from './parserAdapter';
import { effectAdapter } from './effectAdapter';
import { outputFormatAdapter } from './outputFormatAdapter';
import { metadataFacetAdapter } from './metadataFacetAdapter';
import { commandAdapter } from './commandAdapter';
import { dataKindAdapter } from './dataKindAdapter';
import { timelineOverlayAdapter } from './timelineOverlayAdapter';
import { buildParserDescriptors } from './projectors/parserProjector';

import type { HostFamilyAdapter } from '@/sdk/core/families/familyAdapter';
import type {
  SlotContribution,
  MetadataFacetContribution,
  ParserContribution,
} from '@reigh/editor-sdk';

describe('VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY', () => {
  it('is a frozen ReadonlyMap', () => {
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY).toBeInstanceOf(Map);
    expect(Object.isFrozen(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY)).toBe(true);
  });

  it('registers exactly 22 video contribution kinds', () => {
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.size).toBe(22);
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_KINDS.length).toBe(22);
  });

  it('exposes kinds in sorted order', () => {
    const kinds = VIDEO_EDITOR_FAMILY_ADAPTER_KINDS;
    expect(kinds).toEqual([...kinds].sort());
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('covers every known video contribution kind', () => {
    const expectedKinds = [
      'agent',
      'agentTool',
      'assetDetailSection',
      'automation',
      'clipType',
      'command',
      'contextMenuItem',
      'dataKind',
      'dialog',
      'effect',
      'inspectorSection',
      'keybinding',
      'metadataFacet',
      'outputFormat',
      'panel',
      'parser',
      'process',
      'searchProvider',
      'shader',
      'slot',
      'timelineOverlay',
      'transition',
    ];
    for (const kind of expectedKinds) {
      expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.has(kind)).toBe(true);
      expect(VIDEO_EDITOR_FAMILY_ADAPTER_KINDS).toContain(kind);
    }
  });

  it('marks agent as known-unavailable (null)', () => {
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.get('agent')).toBeNull();
  });

  it('has no timelineMarker contribution kind', () => {
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.has('timelineMarker')).toBe(false);
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_KINDS).not.toContain('timelineMarker');
  });

  it('every registered adapter satisfies the HostFamilyAdapter contract', () => {
    for (const [kind, adapter] of VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY) {
      if (adapter === null) continue;
      expect(adapter.kind).toBe(kind);
      expect(adapter.classification).toMatch(/^(real|placeholder)$/);
      expect(adapter.manifest).toBeDefined();
      expect(adapter.manifest.adapterId).toBeTruthy();
      expect(adapter.manifest.kind).toBe(kind);
      expect(adapter.manifest.version).toBeTruthy();
      expect(adapter.manifest.maturity).toBeTruthy();
      expect(typeof adapter.normalize).toBe('function');
      expect(typeof adapter.buildConformanceReport).toBe('function');
    }
  });

  it('real compatibility adapters carry real metadata', () => {
    const realKinds = [
      'slot',
      'dialog',
      'panel',
      'inspectorSection',
      'timelineOverlay',
      'metadataFacet',
      'process',
      'command',
      'contextMenuItem',
      'keybinding',
      'automation',
      'clipType',
      'dataKind',
    ];
    for (const kind of realKinds) {
      const adapter = VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.get(
        kind,
      ) as HostFamilyAdapter;
      expect(adapter).not.toBeNull();
      expect(adapter.classification).toBe('real');
      expect(adapter.manifest.metadata?.classification).toBe('real');
    }
  });

  it('placeholder adapters carry delegation metadata', () => {
    const placeholderKinds = [
      'outputFormat',
      'searchProvider',
      'assetDetailSection',
      'parser',
      'effect',
      'transition',
      'shader',
      'agentTool',
    ];
    for (const kind of placeholderKinds) {
      const adapter = VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.get(
        kind,
      ) as HostFamilyAdapter;
      expect(adapter).not.toBeNull();
      expect(adapter.classification).toBe('placeholder');
      expect(adapter.manifest.metadata?.classification).toBe('placeholder');
      expect(adapter.manifest.metadata?.owner).toBeTruthy();
      expect(adapter.manifest.metadata?.reason).toBeTruthy();
      expect(adapter.manifest.metadata?.expiration).toBeTruthy();
    }
  });
});

describe('slotAdapter', () => {
  it('normalizes a slot contribution into a descriptor with a null renderer', () => {
    const contribution: SlotContribution = {
      id: 'slot.header-left',
      kind: 'slot',
      slot: 'header-left',
      order: 1,
    } as unknown as SlotContribution;

    const result = slotAdapter.normalize({
      contributions: [{ contribution, extensionId: 'ext-1' }],
      extensionOrder: new Map([['ext-1', 0]]),
    });

    expect(result.descriptors).toHaveLength(1);
    const descriptor = result.descriptors[0];
    expect(descriptor.slot).toBe('header-left');
    expect(descriptor.render).toBeNull();
    expect(Object.isFrozen(result.descriptors)).toBe(true);
  });
});

describe('parserAdapter', () => {
  it('projects parser contributions into asset-parser descriptors', () => {
    const contribution: ParserContribution = {
      id: 'parser.csv',
      kind: 'parser',
      label: 'CSV parser',
      acceptMimeTypes: ['text/csv'],
      acceptExtensions: ['.csv'],
      required: true,
    } as unknown as ParserContribution;

    const result = parserAdapter.normalize({
      contributions: [{ contribution, extensionId: 'ext-1' }],
    });

    expect(result.descriptors).toHaveLength(1);
    const descriptor = result.descriptors[0];
    expect(descriptor.id).toBe('parser.csv');
    expect(descriptor.extensionId).toBe('ext-1');
    expect(descriptor.label).toBe('CSV parser');
    expect(descriptor.acceptMimeTypes).toContain('text/csv');
  });

  it('uses the projector helper directly', () => {
    const descriptors = buildParserDescriptors(
      [
        {
          contribution: {
            id: 'parser.json',
            kind: 'parser',
            label: 'JSON parser',
            acceptExtensions: ['.json'],
          } as unknown as ParserContribution,
          extensionId: 'ext-2',
        },
      ],
      new Map([['ext-2', 0]]),
    );

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].extensionId).toBe('ext-2');
    expect(Object.isFrozen(descriptors)).toBe(true);
  });
});

describe('effectAdapter', () => {
  it('reports conformance for the delegated effect family', () => {
    const report = effectAdapter.buildConformanceReport();
    expect(report.kind).toBe('effect');
    expect(report.executionMaturity).toBe('delegated');
    expect(report.gaps.length).toBeGreaterThan(0);
  });
});

describe('outputFormatAdapter', () => {
  it('is a placeholder with M12 expiration metadata', () => {
    expect(outputFormatAdapter.classification).toBe('placeholder');
    expect(outputFormatAdapter.manifest.metadata?.expiration).toBe('M12');
  });
});

describe('metadataFacetAdapter', () => {
  it('normalizes metadata facet contributions', () => {
    const contribution: MetadataFacetContribution = {
      id: 'facet.genre',
      kind: 'metadataFacet',
      fieldPath: 'metadata.genre',
      displayName: 'Genre',
      valueKind: 'enum',
      aggregationPosture: 'filterable',
      enumValues: ['action', 'drama'],
    } as unknown as MetadataFacetContribution;

    const result = metadataFacetAdapter.normalize({
      contributions: [{ contribution, extensionId: 'ext-1' }],
    });

    expect(result.descriptors).toHaveLength(1);
    const descriptor = result.descriptors[0];
    expect(descriptor.fieldPath).toBe('metadata.genre');
    expect(descriptor.enumValues).toEqual(['action', 'drama']);
  });
});

describe('commandAdapter', () => {
  it('is a real compatibility adapter with empty normalization', () => {
    expect(commandAdapter.classification).toBe('real');
    const result = commandAdapter.normalize({ contributions: [] });
    expect(result.descriptors).toEqual([]);
    expect(Object.isFrozen(result.descriptors)).toBe(true);
  });
});

describe('dataKindAdapter', () => {
  it('is a real compatibility adapter registered for the dataKind kind', () => {
    expect(dataKindAdapter.classification).toBe('real');
    expect(dataKindAdapter.kind).toBe('dataKind');
    expect(
      VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.get('dataKind'),
    ).toBe(dataKindAdapter);
  });

  it('projects zero frozen descriptors (lane state binds via the registry)', () => {
    const result = dataKindAdapter.normalize({ contributions: [] });
    expect(result.descriptors).toEqual([]);
    expect(Object.isFrozen(result.descriptors)).toBe(true);
  });

  it('buildConformanceReport reads the SDK family definition', () => {
    const report = dataKindAdapter.buildConformanceReport();
    expect(report.kind).toBe('dataKind');
    // Rework R4: declaration maturity is the honest schema-backed level. The
    // gate flags schema-backed + host-integrated as incoherent (host-
    // integrated requires declaration >= documented) — an advisory audit
    // warning until examples/docs coverage closes the gap.
    expect(report.declarationMaturity).toBe('schema-backed');
    expect(report.executionMaturity).toBe('host-integrated');
    expect(report.coherent).toBe(false);
  });
});

describe('timelineOverlayAdapter', () => {
  it('is a real adapter registered for the timelineOverlay kind', () => {
    expect(timelineOverlayAdapter.classification).toBe('real');
    expect(timelineOverlayAdapter.kind).toBe('timelineOverlay');
    expect(VIDEO_EDITOR_FAMILY_ADAPTER_REGISTRY.get('timelineOverlay')).toBe(
      timelineOverlayAdapter,
    );
  });

  it('projects extensionId, id, renderId, and order through the dedicated projector', () => {
    const result = timelineOverlayAdapter.normalize({
      contributions: [
        {
          contribution: {
            id: 'ruler-overlay',
            kind: 'timelineOverlay',
            order: 4,
            render: 'render/ruler-overlay',
          } as unknown as Parameters<typeof timelineOverlayAdapter.normalize>[0]['contributions'][number]['contribution'],
          extensionId: 'ext-overlay-1',
        },
      ],
      extensionOrder: new Map([['ext-overlay-1', 0]]),
    });

    expect(result.descriptors).toHaveLength(1);
    const descriptor = result.descriptors[0];
    expect(descriptor.extensionId).toBe('ext-overlay-1');
    expect(descriptor.id).toBe('ruler-overlay');
    expect(descriptor.renderId).toBe('render/ruler-overlay');
    expect(descriptor.order).toBe(4);
    expect(Object.isFrozen(result.descriptors)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it('never emits callable or null placeholder renderers', () => {
    const result = timelineOverlayAdapter.normalize({
      contributions: [
        {
          contribution: {
            id: 'ruler-overlay',
            kind: 'timelineOverlay',
            render: 'render/ruler-overlay',
          } as unknown as Parameters<typeof timelineOverlayAdapter.normalize>[0]['contributions'][number]['contribution'],
          extensionId: 'ext-overlay-1',
        },
      ],
    });

    const descriptor = result.descriptors[0];
    expect('render' in descriptor).toBe(false);
    expect((descriptor as { render?: unknown }).render).toBeUndefined();
    expect((descriptor as { render?: unknown }).render).not.toBeNull();
    expect(typeof (descriptor as { render?: unknown }).render).not.toBe('function');
    expect('when' in descriptor).toBe(false);
    expect((descriptor as { when?: unknown }).when).toBeUndefined();
  });

  it('reports conformance for the host-integrated timeline overlay family', () => {
    const report = timelineOverlayAdapter.buildConformanceReport();
    expect(report.kind).toBe('timelineOverlay');
    expect(report.executionMaturity).toBe('host-integrated');
  });
});
