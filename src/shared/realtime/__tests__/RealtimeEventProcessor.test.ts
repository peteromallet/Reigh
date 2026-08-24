/**
 * RealtimeEventProcessor Tests
 *
 * Tests for event batching and normalization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
import { RealtimeEventProcessor } from '../RealtimeEventProcessor';
import type { RawDatabaseEvent, ProcessedEvent } from '../types';

function makeRawEvent(overrides: Partial<RawDatabaseEvent> = {}): RawDatabaseEvent {
  return {
    table: 'tasks',
    eventType: 'INSERT',
    new: { id: 'task-1', project_id: 'proj-1', task_type: 'image_generation' },
    old: null,
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe('RealtimeEventProcessor', () => {
  let processor: RealtimeEventProcessor;

  beforeEach(() => {
    vi.useFakeTimers();
    processor = new RealtimeEventProcessor({ batchWindowMs: 100 });
  });

  afterEach(() => {
    processor.destroy();
    vi.useRealTimers();
  });

  describe('event subscription', () => {
    it('allows subscribing to processed events', () => {
      const callback = vi.fn();
      const unsubscribe = processor.onEvent(callback);
      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe stops receiving events', () => {
      const callback = vi.fn();
      const unsubscribe = processor.onEvent(callback);

      processor.process(makeRawEvent());
      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      processor.process(makeRawEvent());
      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('event batching', () => {
    it('batches events within the window', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({ new: { id: 'task-1', project_id: 'proj-1', task_type: 'gen' } }));
      processor.process(makeRawEvent({ new: { id: 'task-2', project_id: 'proj-1', task_type: 'gen' } }));

      // Not yet emitted
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);

      // Now emitted as a single batch
      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0] as ProcessedEvent;
      expect(event.type).toBe('tasks-created');
      expect(event.batchSize).toBe(2);
    });

    it('resets batch timer on new events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent());
      vi.advanceTimersByTime(80); // Almost at 100ms

      processor.process(makeRawEvent({ new: { id: 'task-2', project_id: 'proj-1', task_type: 'gen' } }));
      vi.advanceTimersByTime(80); // 80ms from second event

      // Still not emitted (only 80ms since last event)
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30); // Now 110ms from second event
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush', () => {
    it('immediately processes pending events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent());
      expect(callback).not.toHaveBeenCalled();

      processor.flush();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does nothing when queue is empty', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.flush();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('clears pending events without emitting', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent());
      processor.clear();

      vi.advanceTimersByTime(200);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('task processing', () => {
    it('processes task INSERT events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'tasks',
        eventType: 'INSERT',
        new: { id: 'task-1', project_id: 'proj-1', task_type: 'image_generation' },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('tasks-created');
      expect(event.tasks).toHaveLength(1);
      expect(event.tasks[0]).toEqual({
        id: 'task-1',
        taskType: 'image_generation',
        projectId: 'proj-1',
      });
    });

    it('processes task UPDATE events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'tasks',
        eventType: 'UPDATE',
        new: { id: 'task-1', status: 'Complete', project_id: 'proj-1', task_type: 'gen' },
        old: { status: 'In Progress' },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('tasks-updated');
      expect(event.tasks[0].isComplete).toBe(true);
      expect(event.tasks[0].isFailed).toBe(false);
    });

    it('detects failed tasks', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'tasks',
        eventType: 'UPDATE',
        new: { id: 'task-1', status: 'Failed', project_id: 'proj-1', task_type: 'gen' },
        old: { status: 'In Progress' },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.tasks[0].isFailed).toBe(true);
      expect(event.tasks[0].isComplete).toBe(false);
    });
  });

  describe('generation processing', () => {
    it('processes generation INSERT events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'generations',
        eventType: 'INSERT',
        new: {
          id: 'gen-1',
          project_id: 'proj-1',
          type: 'image',
          shot_id: 'shot-1',
          location: '/path/to/image.png',
        },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('generations-inserted');
      expect(event.generations[0]).toMatchObject({
        id: 'gen-1',
        projectId: 'proj-1',
        shotId: 'shot-1',
        hasLocation: true,
      });
    });

    it('processes generation UPDATE events and detects changes', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'generations',
        eventType: 'UPDATE',
        new: {
          id: 'gen-1',
          location: '/new/path.png',
          thumbnail_url: '/new/thumb.png',
          shot_id: 'shot-1',
          starred: true,
        },
        old: {
          location: '/old/path.png',
          thumbnail_url: '/old/thumb.png',
          shot_id: 'shot-1',
          starred: false,
        },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('generations-updated');
      expect(event.generations[0].locationChanged).toBe(true);
      expect(event.generations[0].thumbnailChanged).toBe(true);
      expect(event.generations[0].starredChanged).toBe(true);
    });

    it('processes generation DELETE events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'generations',
        eventType: 'DELETE',
        new: {},
        old: { id: 'gen-1', project_id: 'proj-1', shot_id: 'shot-1' },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('generations-deleted');
      expect(event.generations[0].id).toBe('gen-1');
    });
  });

  describe('variant processing', () => {
    it('processes variant INSERT/UPDATE events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'generation_variants',
        eventType: 'INSERT',
        new: {
          id: 'var-1',
          generation_id: 'gen-1',
          is_primary: true,
        },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('variants-changed');
      expect(event.affectedGenerationIds).toContain('gen-1');
      expect(event.variants[0].isPrimary).toBe(true);
    });

    it('processes variant DELETE events', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'generation_variants',
        eventType: 'DELETE',
        new: {},
        old: { id: 'var-1', generation_id: 'gen-1' },
      }));

      processor.flush();

      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('variants-deleted');
      expect(event.affectedGenerationIds).toContain('gen-1');
    });
  });

  describe('unknown table', () => {
    it('ignores events from unknown tables', () => {
      const callback = vi.fn();
      processor.onEvent(callback);

      processor.process(makeRawEvent({
        table: 'unknown_table' as 'tasks',
        eventType: 'INSERT',
      }));

      processor.flush();

      // Should not emit any event
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('catches errors in callbacks and continues', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const goodCallback = vi.fn();

      processor.onEvent(errorCallback);
      processor.onEvent(goodCallback);

      processor.process(makeRawEvent());
      processor.flush();

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
    });
  });
});
