import { ZodError } from 'zod';

import { TimelineConfigSchema } from './validators.js';
import type { TimelineConfig } from './types.js';
import { toJsonSchema, type JsonSchema7 } from './json-schema.js';

export const CURRENT_TIMELINE_SCHEMA_VERSION = 1;

const getErrorPath = (error: ZodError): string => {
  const issue = error.issues[0];
  if (!issue) {
    return '<root>';
  }

  return issue.path.length > 0 ? issue.path.join('.') : '<root>';
};

export const migrate = (prev: unknown, fromVersion = CURRENT_TIMELINE_SCHEMA_VERSION): TimelineConfig => {
  if (fromVersion !== CURRENT_TIMELINE_SCHEMA_VERSION) {
    throw new Error(`Failed to migrate timeline from version ${fromVersion}: unsupported source version`);
  }

  try {
    return TimelineConfigSchema.parse(prev);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(
        `Failed to migrate timeline from version ${fromVersion} at ${getErrorPath(error)}: ${error.issues[0]?.message ?? 'invalid timeline config'}`,
      );
    }

    throw error;
  }
};

export const migrateTimeline = migrate;
export { toJsonSchema };
export type { JsonSchema7 };
