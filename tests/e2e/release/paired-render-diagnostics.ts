export type RenderTaskTerminalStatus = 'failed' | 'cancelled';

export type RenderFailureDiagnosticInput = {
  blockerText?: string | null;
  taskId?: string | null;
  task?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function redactDiagnosticText(value: string): string {
  return value
    // Header- and bearer-shaped credentials.
    .replace(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;)]+/gi, 'Authorization: [REDACTED]')
    .replace(/\bBearer\s+[^\s,;)]+/gi, 'Bearer [REDACTED]')
    // Named token/key credentials in query, log, and exception syntax.
    .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|token|secret)(\s*[:=]\s*)[^\s,;)]+/gi, '$1$2[REDACTED]')
    .replace(/\b(aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key))(\s*[:=]\s*)[^\s,;)]+/gi, '$1$2[REDACTED]')
    // URL userinfo, including non-HTTP schemes used by local services.
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@/gi, (match) => {
      const scheme = match.slice(0, match.indexOf('://'));
      return `${scheme}://[REDACTED]@`;
    })
    // AWS access-key IDs (named AWS key fields are covered by the token rule).
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    // Common absolute filesystem paths; keep relative task diagnostics useful.
    .replace(/(^|[\s("'=])\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~:@%+,-]+/g, '$1[REDACTED_PATH]');
}

function taskIdOf(task: unknown): string | null {
  const record = asRecord(task);
  return stringValue(record?.task_id) ?? stringValue(record?.id);
}

function taskStatusOf(task: unknown): string | null {
  return stringValue(asRecord(task)?.status);
}

function taskErrorDetails(task: unknown): string[] {
  const record = asRecord(task);
  if (!record) return [];
  const details: string[] = [];
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  const latestAttempt = asRecord(attempts.at(-1))
    ?? asRecord(record.latest_attempt)
    ?? asRecord(record.latestAttempt);
  const diagnosticError = asRecord(asRecord(latestAttempt?.diagnostics)?.error);
  for (const key of ['message', 'code', 'reason', 'type']) {
    const value = stringValue(diagnosticError?.[key]);
    if (value) details.push(`attempt.diagnostics.error.${key}=${redactDiagnosticText(value)}`);
  }
  return details;
}

export function isTerminalRenderTaskStatus(status: unknown): status is RenderTaskTerminalStatus {
  return status === 'failed' || status === 'cancelled';
}

/**
 * Keep paired-render failures actionable even when the UI only exposes its
 * concise first-line blocker. Include the task identity/status and any error
 * fields the bridge supplied, while bounding the message for CI logs.
 */
export function formatRenderFailureDiagnostic({ blockerText, taskId, task }: RenderFailureDiagnosticInput): string {
  const visible = stringValue(blockerText);
  const resolvedTaskId = taskId ?? taskIdOf(task);
  const status = taskStatusOf(task);
  const details = taskErrorDetails(task);
  const taskDescription = resolvedTaskId || status || details.length > 0
    ? `Astrid task ${redactDiagnosticText(resolvedTaskId ?? '<unknown>')} status ${redactDiagnosticText(status ?? '<unknown>')}${details.length > 0 ? ` (${details.join('; ')})` : ''}.`
    : 'No terminal Astrid task detail was available.';
  const message = [
    'Paired render did not produce a download.',
    visible ? `Visible render blocker: ${redactDiagnosticText(visible)}.` : null,
    taskDescription,
  ].filter((part): part is string => Boolean(part)).join(' ');
  return message.length > 4_000 ? `${message.slice(0, 3_997)}...` : message;
}
