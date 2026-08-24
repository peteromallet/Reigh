import { useEffect } from 'react';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import type { ProjectImageSettings, ReferenceImage } from '../../types';
import type { LegacyMigrationsInput } from './types';

type ReferenceStructureMigrationInput = Pick<
  LegacyMigrationsInput,
  'projectImageSettings' | 'selectedProjectId' | 'effectiveShotId' | 'updateProjectImageSettings'
>;

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function buildLegacyReference(settings: ProjectImageSettings): ReferenceImage {
  return {
    id: crypto.randomUUID(),
    resourceId: '',
    name: 'Reference 1',
    styleReferenceImage: stringOrUndefined(settings.styleReferenceImage),
    styleReferenceImageOriginal: stringOrUndefined(settings.styleReferenceImageOriginal),
    styleReferenceStrength: finiteNumberOrUndefined(settings.styleReferenceStrength) ?? 1.1,
    subjectStrength: finiteNumberOrUndefined(settings.subjectStrength) ?? 0.0,
    subjectDescription: typeof settings.subjectDescription === 'string' ? settings.subjectDescription : '',
    inThisScene: booleanOrUndefined(settings.inThisScene) ?? false,
    inThisSceneStrength: 1.0,
    referenceMode: 'style',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// SUNSET: 2026-09-01 — remove after all projects have references[] and selectedReferenceIdByShot.
export function useReferenceStructureMigration(input: ReferenceStructureMigrationInput): void {
  const {
    projectImageSettings,
    selectedProjectId,
    effectiveShotId,
    updateProjectImageSettings,
  } = input;

  useEffect(() => {
    const migrateLegacyReference = async () => {
      if (!projectImageSettings || !selectedProjectId) {
        return;
      }

      let needsMigration = false;
      const updates: Partial<ProjectImageSettings> = {};

      const hasLegacyFlatFormat =
        projectImageSettings.styleReferenceImage && !projectImageSettings.references;

      if (hasLegacyFlatFormat) {
        needsMigration = true;
        const legacyReference = buildLegacyReference(projectImageSettings);

        updates.references = [legacyReference];
        updates.selectedReferenceIdByShot = { [effectiveShotId]: legacyReference.id };
        updates.styleReferenceImage = undefined;
        updates.styleReferenceImageOriginal = undefined;
        updates.styleReferenceStrength = undefined;
        updates.subjectStrength = undefined;
        updates.subjectDescription = undefined;
        updates.inThisScene = undefined;
        updates.selectedReferenceId = undefined;
      }

      const hasLegacyProjectWideSelection =
        projectImageSettings.selectedReferenceId &&
        !projectImageSettings.selectedReferenceIdByShot;

      if (hasLegacyProjectWideSelection && !hasLegacyFlatFormat) {
        needsMigration = true;
        updates.selectedReferenceIdByShot = {
          [effectiveShotId]: projectImageSettings.selectedReferenceId ?? null,
        };
        updates.selectedReferenceId = undefined;
      }

      if (!needsMigration) {
        return;
      }

      try {
        await updateProjectImageSettings('project', updates);
      } catch (error) {
        normalizeAndPresentError(error, {
          context: 'ImageGenerationForm.migrateLegacyReference',
          showToast: false,
        });
      }
    };

    void migrateLegacyReference();
  }, [
    effectiveShotId,
    projectImageSettings,
    selectedProjectId,
    updateProjectImageSettings,
  ]);
}
