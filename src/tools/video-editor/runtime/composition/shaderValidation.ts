import type { TimelineShaderScope } from '@/tools/video-editor/types/index.ts';

export interface CompositionShaderIdentity {
  readonly scope: TimelineShaderScope;
  readonly extensionId: string;
  readonly contributionId: string;
  readonly shaderId: string;
}

export interface CompositionShaderStackEntry extends CompositionShaderIdentity {
  readonly clipId?: string;
}

export interface ShaderScopeOccupied<T extends CompositionShaderStackEntry = CompositionShaderStackEntry> {
  readonly scope: TimelineShaderScope;
  readonly clipId?: string;
  readonly existing: T;
  readonly incoming: T;
  readonly shaderCount: number;
  readonly message: string;
}

export type ShaderStackValidationResult<T extends CompositionShaderStackEntry = CompositionShaderStackEntry> =
  | { readonly ok: true }
  | { readonly ok: false; readonly occupied: ShaderScopeOccupied<T> };

export function sameCompositionShaderIdentity(
  left: CompositionShaderIdentity,
  right: CompositionShaderIdentity,
): boolean {
  return (
    left.scope === right.scope
    && left.extensionId === right.extensionId
    && left.contributionId === right.contributionId
    && left.shaderId === right.shaderId
  );
}

export function shaderScopeOccupiedMessage(
  scope: TimelineShaderScope,
  existingShaderId: string,
  incomingShaderId: string,
  clipId?: string,
): string {
  if (scope === 'clip') {
    const target = clipId ? `clip "${clipId}"` : 'the clip scope';
    return `Cannot add shader "${incomingShaderId}" to ${target} because shader "${existingShaderId}" is already assigned. `
      + 'V1 supports one clip shader per clip. Remove the existing shader before assigning another.';
  }

  return `Cannot add postprocess shader "${incomingShaderId}" because postprocess shader "${existingShaderId}" is already assigned. `
    + 'V1 supports one timeline postprocess shader. Remove the existing postprocess shader before assigning another.';
}

export function createShaderScopeOccupied<T extends CompositionShaderStackEntry>(
  existing: T,
  incoming: T,
  shaderCount = 2,
): ShaderScopeOccupied<T> {
  return {
    scope: incoming.scope,
    clipId: incoming.scope === 'clip' ? incoming.clipId ?? existing.clipId : undefined,
    existing,
    incoming,
    shaderCount,
    message: shaderScopeOccupiedMessage(
      incoming.scope,
      existing.shaderId,
      incoming.shaderId,
      incoming.scope === 'clip' ? incoming.clipId ?? existing.clipId : undefined,
    ),
  };
}

export function validateShaderStack<T extends CompositionShaderStackEntry>(
  stack: readonly T[],
): ShaderStackValidationResult<T> {
  if (stack.length < 2) {
    return { ok: true };
  }

  return {
    ok: false,
    occupied: createShaderScopeOccupied(stack[0]!, stack[1]!, stack.length),
  };
}
