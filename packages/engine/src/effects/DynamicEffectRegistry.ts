import type { FC } from 'react';
import type { ParameterSchema } from '@tbd/schema';
import { compileEffect, compileEffectAsync } from './compileEffect.js';
import type { EffectComponentProps } from './entrances.js';

type DynamicEffectRecord = {
  component: FC<EffectComponentProps>;
  code: string;
  schema?: ParameterSchema;
};

export class DynamicEffectRegistry {
  private builtIn: Record<string, FC<EffectComponentProps>>;
  private dynamic: Record<string, DynamicEffectRecord> = {};
  private pendingAsync: Record<string, { code: string; schema?: ParameterSchema }> = {};
  private _version = 0;
  private _batchDepth = 0;
  private _pendingNotify = false;
  private _listeners = new Set<() => void>();

  constructor(builtIn: Record<string, FC<EffectComponentProps>>) {
    this.builtIn = { ...builtIn };
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSnapshot = (): number => this._version;

  async batch(fn: () => void | Promise<void>): Promise<void> {
    this._batchDepth += 1;
    try {
      await fn();
    } finally {
      this._batchDepth -= 1;
      if (this._batchDepth === 0 && this._pendingNotify) {
        this._pendingNotify = false;
        this._notify();
      }
    }
  }

  register(name: string, code: string, schema?: ParameterSchema): void {
    const normalized = this.normalizeName(name);
    const existing = this.dynamic[normalized];
    if (existing?.code === code && this.schemasEqual(existing.schema, schema)) return;
    delete this.pendingAsync[normalized];
    const component = compileEffect(code);
    this.dynamic[normalized] = { component, code, schema };
    this._notify();
  }

  async registerAsync(name: string, code: string, schema?: ParameterSchema): Promise<void> {
    const normalized = this.normalizeName(name);
    const existing = this.dynamic[normalized];
    if (existing?.code === code && this.schemasEqual(existing.schema, schema)) return;
    this.pendingAsync[normalized] = { code, schema };
    const component = await compileEffectAsync(code);
    const pending = this.pendingAsync[normalized];
    if (!pending || pending.code !== code || !this.schemasEqual(pending.schema, schema)) return;
    delete this.pendingAsync[normalized];
    this.dynamic[normalized] = { component, code, schema };
    this._notify();
  }

  unregister(name: string): void {
    const normalized = this.normalizeName(name);
    if (!(normalized in this.dynamic)) return;
    delete this.pendingAsync[normalized];
    delete this.dynamic[normalized];
    this._notify();
  }

  get(name: string): FC<EffectComponentProps> | undefined {
    const normalized = this.normalizeName(name);
    return this.builtIn[normalized] ?? this.dynamic[normalized]?.component;
  }

  getCode(name: string): string | undefined {
    return this.dynamic[this.normalizeName(name)]?.code;
  }

  getSchema(name: string): ParameterSchema | undefined {
    return this.dynamic[this.normalizeName(name)]?.schema;
  }

  listAll(): string[] {
    return [...new Set([...Object.keys(this.builtIn), ...Object.keys(this.dynamic)])];
  }

  isDynamic(name: string): boolean {
    const normalized = this.normalizeName(name);
    return normalized in this.dynamic && !(normalized in this.builtIn);
  }

  getAllDynamicCode(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.dynamic).map(([name, { code }]) => [name, code]),
    );
  }

  private schemasEqual(a?: ParameterSchema, b?: ParameterSchema): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
  }

  private _notify(): void {
    if (this._batchDepth > 0) {
      this._pendingNotify = true;
      return;
    }
    this._version += 1;
    this._listeners.forEach((listener) => listener());
  }

  private normalizeName(name: string): string {
    return name.startsWith('custom:') ? name.slice(7) : name;
  }
}
