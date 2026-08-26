import { describe, expect, it } from 'vitest';
import {
  formatRenderFailureDiagnostic,
  isTerminalRenderTaskStatus,
} from './paired-render-diagnostics';

describe('paired render failure diagnostics', () => {
  it('recognizes only terminal task statuses', () => {
    expect(isTerminalRenderTaskStatus('failed')).toBe(true);
    expect(isTerminalRenderTaskStatus('cancelled')).toBe(true);
    expect(isTerminalRenderTaskStatus('running')).toBe(false);
    expect(isTerminalRenderTaskStatus(undefined)).toBe(false);
  });

  it('combines the visible blocker with task identity and nested executor details', () => {
    const message = formatRenderFailureDiagnostic({
      blockerText: 'Astrid render failed. Open task details for executor diagnostics.',
      task: {
        task_id: 'task-render-33',
        status: 'failed',
        attempts: [{ diagnostics: { error: {
          message: 'ffmpeg exited with code 1', code: 'FFMPEG_EXIT', reason: 'encoder failed', type: 'worker',
        } } }],
      },
    });
    expect(message).toContain('Visible render blocker: Astrid render failed');
    expect(message).toContain('Astrid task task-render-33 status failed');
    expect(message).toContain('attempt.diagnostics.error.message=ffmpeg exited with code 1');
    expect(message).toContain('attempt.diagnostics.error.code=FFMPEG_EXIT');
    expect(message).toContain('attempt.diagnostics.error.reason=encoder failed');
    expect(message).toContain('attempt.diagnostics.error.type=worker');
  });

  it('never includes arbitrary task fields and redacts credential/path-shaped diagnostics', () => {
    const message = formatRenderFailureDiagnostic({
      blockerText: 'render failed; token=ui-secret',
      task: {
        task_id: 'task-render-34',
        status: 'failed',
        error_message: 'top-level secret must not be logged',
        arbitrary: 'arbitrary task field must not be logged',
        attempts: [{
          diagnostics: { error: {
            message: 'Authorization: Bearer browser-secret token=worker-secret https://alice:password@example.test /Users/alice/private.mp4 AKIAIOSFODNN7EXAMPLE',
            code: 'FFMPEG_EXIT',
            reason: 'failed at /tmp/secret-output.mp4',
            type: 'worker',
            arbitrary: 'nested field must not be logged',
          } },
          arbitrary: 'attempt field must not be logged',
        }],
      },
    });
    expect(message).toContain('code=FFMPEG_EXIT');
    expect(message).toContain('type=worker');
    expect(message).not.toContain('ui-secret');
    expect(message).not.toContain('browser-secret');
    expect(message).not.toContain('worker-secret');
    expect(message).not.toContain('alice:password');
    expect(message).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(message).not.toContain('/Users/alice/private.mp4');
    expect(message).not.toContain('/tmp/secret-output.mp4');
    expect(message).not.toContain('top-level secret must not be logged');
    expect(message).not.toContain('arbitrary');
  });

  it('bounds malformed or unusually large bridge diagnostics', () => {
    const message = formatRenderFailureDiagnostic({
      taskId: 'task-large',
      task: {
        status: 'failed',
        attempts: [{ diagnostics: { error: { message: 'x'.repeat(10_000) } } }],
      },
    });
    expect(message.length).toBe(4_000);
    expect(message.endsWith('...')).toBe(true);
  });
});
