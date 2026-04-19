export type JsonSchema7 = Record<string, unknown>;

export const TIMELINE_JSON_SCHEMA: JsonSchema7 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://tbd.dev/schema/timeline/v1.json',
  title: 'TimelineConfig',
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['resolution', 'fps', 'file'],
      properties: {
        resolution: { type: 'string', minLength: 1 },
        fps: { type: 'number' },
        file: { type: 'string', minLength: 1 },
        background: { type: ['string', 'null'] },
        background_scale: { type: ['number', 'null'] },
      },
    },
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'label'],
        properties: {
          id: { type: 'string', minLength: 1 },
          kind: { enum: ['visual', 'audio'] },
          label: { type: 'string', minLength: 1 },
          scale: { type: 'number' },
          fit: { enum: ['cover', 'contain', 'manual'] },
          opacity: { type: 'number' },
          volume: { type: 'number' },
          muted: { type: 'boolean' },
          blendMode: {
            enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light'],
          },
          app: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: true,
          },
        },
      },
    },
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'at', 'track'],
        properties: {
          id: { type: 'string', minLength: 1 },
          at: { type: 'number', minimum: 0 },
          track: { type: 'string', minLength: 1 },
          clipType: { enum: ['media', 'hold', 'text', 'effect-layer'] },
          asset: { type: 'string' },
          from: { type: 'number' },
          to: { type: 'number' },
          speed: { type: 'number', exclusiveMinimum: 0 },
          hold: { type: 'number' },
          volume: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          cropTop: { type: 'number' },
          cropBottom: { type: 'number' },
          cropLeft: { type: 'number' },
          cropRight: { type: 'number' },
          opacity: { type: 'number' },
          text: {
            type: 'object',
            additionalProperties: false,
            required: ['content'],
            properties: {
              content: { type: 'string' },
              fontFamily: { type: 'string' },
              fontSize: { type: 'number' },
              color: { type: 'string' },
              align: { enum: ['left', 'center', 'right'] },
              bold: { type: 'boolean' },
              italic: { type: 'boolean' },
            },
          },
          entrance: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'duration'],
            properties: {
              type: { type: 'string', minLength: 1 },
              duration: { type: 'number' },
              intensity: { type: 'number' },
              params: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: true },
            },
          },
          exit: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'duration'],
            properties: {
              type: { type: 'string', minLength: 1 },
              duration: { type: 'number' },
              intensity: { type: 'number' },
              params: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: true },
            },
          },
          continuous: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { type: 'string', minLength: 1 },
              intensity: { type: 'number' },
              params: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: true },
            },
          },
          transition: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'duration'],
            properties: {
              type: { type: 'string', minLength: 1 },
              duration: { type: 'number' },
            },
          },
          effects: {
            anyOf: [
              {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    fade_in: { type: 'number' },
                    fade_out: { type: 'number' },
                  },
                },
              },
              {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: { type: 'number' },
              },
            ],
          },
          app: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: true,
          },
        },
      },
    },
    app: {
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: true,
    },
  },
  required: ['output', 'clips'],
};

export const toJsonSchema = (): JsonSchema7 => {
  return JSON.parse(JSON.stringify(TIMELINE_JSON_SCHEMA)) as JsonSchema7;
};
