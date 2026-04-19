import { useEffect, useMemo, useState } from 'react';

type Setter<T> = T | ((current: T) => T);

export function useEditorSettings<T>(storageKey: string, initialValue: T, debounceMs = 200) {
  const initial = useMemo(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  }, [initialValue, storageKey]);

  const [value, setValueState] = useState<T>(initial);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    }, debounceMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [debounceMs, storageKey, value]);

  const setValue = (update: Setter<T>) => {
    setValueState((current) => (typeof update === 'function' ? (update as (current: T) => T)(current) : update));
  };

  return [value, setValue] as const;
}
