import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MATRIX, deriveShotExpectations, parseProjectMatrix } from './verify-local-project-gallery.mjs';

test('parses explicit JSON matrix rows and optional expected counts', () => {
  assert.deepEqual(parseProjectMatrix(JSON.stringify([
    { project: ' one ', timeline: ' main ', expectedShots: '2', expectedGenerations: 7 },
    { project: 'two', timeline: 'secondary' },
  ])), [
    { project: 'one', timeline: 'main', expectedShots: 2, expectedGenerations: 7 },
    { project: 'two', timeline: 'secondary' },
  ]);
});

test('parses compact matrix rows', () => {
  assert.deepEqual(parseProjectMatrix('one:main:2:7,two:secondary'), [
    { project: 'one', timeline: 'main', expectedShots: 2, expectedGenerations: 7 },
    { project: 'two', timeline: 'secondary' },
  ]);
});

test('derives pinned visual clip scope and excludes audio clips', () => {
  const shots = deriveShotExpectations({
    config: {
      tracks: [{ id: 'video', kind: 'video' }, { id: 'audio', kind: 'audio' }],
      clips: [
        { id: 'v1', label: 'Opening' },
        { id: 'a1', clipType: 'audio' },
        { id: 'a2' },
      ],
      pinnedShotGroups: [
        { shotId: 'shot-a', name: 'Opening', trackId: 'video', clipIds: ['v1', 'a1'] },
        { shotId: 'shot-b', trackId: 'audio', clipIds: ['a2'] },
      ],
    },
  });
  assert.equal(shots.length, 2);
  assert.deepEqual(shots[0].visualClipIds, ['v1']);
  assert.equal(shots[0].nonVisualClipCount, 1);
  assert.deepEqual(shots[1].visualClipIds, []);
  assert.equal(DEFAULT_MATRIX.length >= 3, true);
});

test('ignores malformed pinned groups without hiding valid groups', () => {
  const shots = deriveShotExpectations({ config: { pinnedShotGroups: [null, {}, { shotId: 'valid', clipIds: [] }] } });
  assert.deepEqual(shots.map((shot) => shot.id), ['valid']);
});
