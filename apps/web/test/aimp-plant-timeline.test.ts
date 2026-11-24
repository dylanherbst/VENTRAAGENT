import assert from 'node:assert/strict';
import test from 'node:test';
import { poseAt, stageAt, terrainHeight, SPROUT } from '../lib/aimp/plant/timeline.ts';

const flat = (o: unknown): number[] => typeof o === 'number' ? [o] : typeof o === 'object' && o ? Object.values(o).flatMap(flat) : [];

test('checkpoints map to the four stages', () => {
  assert.equal(stageAt(0), 'potential'); assert.equal(stageAt(0.2), 'foundation'); assert.equal(stageAt(0.55), 'creation');
  assert.equal(stageAt(0.85), 'growth'); assert.equal(stageAt(1), 'growth'); assert.equal(stageAt(-1), 'potential');
});
test('deterministic and reversible: the same p always gives the same pose', () => {
  for (const p of [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1]) assert.deepEqual(poseAt(p), poseAt(p));
  const forward = [0, 0.3, 0.6, 0.9, 1, 0.6, 0.3, 0].map(poseAt);
  assert.deepEqual(forward[0], forward[7]); assert.deepEqual(forward[2], forward[5]);
});
test('continuous: no value jumps between neighbouring scroll positions', () => {
  let prev = flat(poseAt(0));
  for (let i = 1; i <= 2000; i++) {
    const cur = flat(poseAt(i / 2000));
    cur.forEach((v, k) => assert.ok(Math.abs(v - prev[k]) < 0.02, `jump at p=${i / 2000} field ${k}: ${prev[k]} -> ${v}`));
    prev = cur;
  }
});
test('story beats: floating seed, planted seed, sprout, three-leaf tree', () => {
  const s0 = poseAt(0), s4 = poseAt(0.4), s7 = poseAt(0.7), s1 = poseAt(1);
  assert.ok(s0.seed.visible && s0.seed.y > 1.5 && s0.growth.trunk === 0 && s0.terrain.wave === 0);
  assert.ok(s4.seed.y < 0.8 && s4.terrain.mound > 0.9);
  assert.ok(!s7.seed.visible && Math.abs(s7.growth.trunk - SPROUT) < 1e-9 && s7.leaves.a.scale > 0.4 && s7.leaves.c.scale === 0);
  assert.ok(s1.growth.trunk === 1 && s1.growth.left === 1 && s1.growth.right === 1 && s1.leaves.c.scale > 0.6);
});
test('seed settles onto the ground, then goes into it as the sprout takes over', () => {
  const s0 = poseAt(0).seed, s1 = poseAt(0.1).seed, s4 = poseAt(0.4).seed, s7 = poseAt(0.7).seed;
  assert.ok(s0.settle === 0 && s0.sink === 0 && s0.drift === 0);
  assert.ok(s1.settle === 0 && s1.drift > 0);
  assert.ok(s4.settle === 1 && s4.sink === 0 && s4.drift === 0);
  assert.equal(s7.sink, 1);
});
test('terrain is flat for the floating seed and rises under the planting point', () => {
  assert.equal(terrainHeight(0.06, 0, 0, 0), 0);
  assert.ok(terrainHeight(0.06, 0, 0, 1) > 0.25);
});
