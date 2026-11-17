import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnockout, reconcileKnockout } from '../championships/domain/knockout.ts';

test('confirmed semifinals populate the final and bronze match, protecting a saved final', () => {
  const bracket = createKnockout([['a1', 'a2'], ['b1', 'b2']], 4, true);
  for (const match of bracket.filter(match => match.round === 1)) {
    match.state = 'confirmed';
    match.winner = match.home;
  }
  const advanced = reconcileKnockout(bracket);
  assert.deepEqual(advanced.slice(2).map(match => [match.home, match.away]), [['a1', 'b1'], ['b2', 'a2']]);
  advanced[2].state = 'submitted';
  advanced[0].winner = 'b2';
  assert.throws(() => reconcileKnockout(advanced), /zurückgesetzt/);
});

test('byes immediately fill the correct semifinal slot without awarding a score', () => {
  const bracket = createKnockout([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], 5, false);
  assert.equal(bracket.filter(match => match.state === 'bye').length, 3);
  assert.equal(bracket.find(match => match.round === 2 && match.position === 1).home, 'a1');
  assert.equal(bracket.find(match => match.round === 3).home, null);
});
