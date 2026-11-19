import assert from 'node:assert/strict';
import test from 'node:test';
import { drawSektRound, helperRequirements, validateSektResult } from '../championships/domain/sekt.ts';

function players(first, second) {
  const needs = helperRequirements(first, second);
  return [first, second].flatMap((count, index) => Array.from({ length: count }, (_, position) => ({
    id: `p${index + 1}-${position}`, pot: index + 1, helper: position < (index ? needs.second : needs.first),
  })));
}
for (const [first, second, extraFirst, extraSecond, matches] of [
  [8, 8, 0, 0, 4], [8, 7, 0, 1, 4], [7, 7, 1, 1, 4], [7, 6, 1, 2, 4], [9, 7, 1, 3, 5],
]) test(`draws ${first}/${second} with ${extraFirst}/${extraSecond} helpers`, () => {
  assert.deepEqual(helperRequirements(first, second), { first: extraFirst, second: extraSecond, matches, playable: true });
  for (let attempt = 0; attempt < 50; attempt++) {
    const entrants = players(first, second);
    const draw = drawSektRound(entrants);
    assert.equal(draw.length, matches);
    const tokens = draw.flatMap(match => match.players);
    for (const match of draw) {
      assert.equal(new Set(match.players.map(player => player.playerId)).size, 4);
      for (const team of [1, 2]) assert.deepEqual(match.players.filter(player => player.team === team).map(player => player.pot).sort(), [1, 2]);
    }
    for (const entry of entrants) {
      const games = tokens.filter(player => player.playerId === entry.id);
      assert.equal(games.filter(player => player.counted).length, 1);
      assert.equal(games.filter(player => !player.counted).length, Number(entry.helper));
    }
  }
});
test('all playable pot sizes produce a complete draw without self-matches', () => {
  for (let first = 2; first <= 20; first++) for (let second = 2; second <= 20; second++) {
    if (!helperRequirements(first, second).playable) continue;
    const draw = drawSektRound(players(first, second));
    for (const match of draw) assert.equal(new Set(match.players.map(player => player.playerId)).size, 4);
  }
});
test('impossible distributions, duplicates and wrong helper counts are rejected', () => {
  assert.throws(() => drawSektRound(players(9, 2)));
  assert.throws(() => drawSektRound(players(8, 7).map(player => ({ ...player, helper: false }))));
  const entrants = players(8, 8);
  assert.throws(() => drawSektRound([...entrants, entrants[0]]));
  assert.throws(() => drawSektRound(players(3, 1)));
});
test('4:2 and 4:4 are final, while 3:2 and 5:1 are invalid', () => {
  validateSektResult(4, 2, 4);
  validateSektResult(4, 4, 4);
  for (const result of [[3, 2], [5, 1], [-1, 4], ['4', 2], [4, 1.5]]) {
    assert.throws(() => validateSektResult(...result, 4));
  }
});
