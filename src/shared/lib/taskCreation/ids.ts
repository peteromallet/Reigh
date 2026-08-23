export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for insecure contexts (HTTP on mobile)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function generateTaskId(taskTypePrefix: string): string {
  const runId = generateRunId();
  const shortUuid = generateUUID().slice(0, 6);
  return `${taskTypePrefix}_${runId.substring(2, 10)}_${shortUuid}`;
}

export function generateRunId(): string {
  // Keep the source token unambiguous for Tailwind's content scanner. The
  // equivalent explicit punctuation character class was misread as an
  // arbitrary utility and emitted invalid CSS during every production build.
  return new Date().toISOString().replace(/\D/g, '');
}
