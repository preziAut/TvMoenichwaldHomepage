import assert from 'node:assert/strict';
import test from 'node:test';
import { drawGroups, knockoutOpening, placementGroups, roundRobin, standings, validateGroupAssignment, validateScore } from '../championships/domain/competition.ts';

test('seeded groups are balanced and repeatable with missing seeds', () => {
  for (const size of [16, 17, 18]) {
    const entries = Array.from({ length: size }, (_, i) => ({ id: String(i), seed: i < 7 ? i + 1 : null }));
    const groups = drawGroups(entries, 4, 113);
    assert.deepEqual(groups, drawGroups(entries.toReversed(), 4, 113));
    assert.equal(new Set(groups.flat()).size, size);
    assert.equal(groups.flat().length, size);
    assert.ok(Math.max(...groups.map(group => group.length)) - Math.min(...groups.map(group => group.length)) <= 1);
    assert.ok(groups.every(group => group.filter(id => Number(id) < 4).length === 1));
  }
  assert.throws(() => drawGroups([{ id: 'a', seed: 1 }, { id: 'b', seed: 1 }], 1, 113));
});

test('round robin schedules every pair once and gives no player two matches per round', () => {
  for (const [n, expected] of [[3, 3], [4, 6], [5, 10]]) {
    const fixtures = roundRobin(Array.from({ length: n }, (_, i) => `p${i}`));
    assert.equal(fixtures.length, expected);
    assert.equal(new Set(fixtures.map(({ home, away }) => [home, away].sort().join('/'))).size, expected);
    const playerRounds = fixtures.flatMap(({ home, away, round }) => [`${home}/${round}`, `${away}/${round}`]);
    assert.equal(new Set(playerRounds).size, 2 * expected);
  }
});

test('best of three accepts only completed, regular matches', () => {
  for (const score of [[[6, 3], [6, 4]], [[6, 4], [3, 6], [6, 2]], [[7, 6], [7, 5]]]) assert.equal(validateScore(score), 0);
  assert.equal(validateScore([[0, 6], [5, 7]]), 1);
  for (const score of [[], [[6, 3]], [[6, 5], [6, 2]], [[7, 4], [6, 0]],
    [[6, -1], [6, 1]], [[7, 7], [6, 1]], [[6, 2], [6, 3], [6, 1]], [[6, 3], [3, 6], [10, 8]]]) {
    assert.throws(() => validateScore(score));
  }
});

test('standings reflect confirmed results, head-to-head and unresolved circular ties', () => {
  const game = (home, away, score = [[6, 3], [6, 3]]) => ({ home, away, score });
  const played = [game('a', 'b'), game('b', 'c'), game('c', 'a')];
  assert.deepEqual(standings(['c', 'b', 'a'], played).map(row => [row.id, row.rank, row.tied]),
    [['a', 1, true], ['b', 1, true], ['c', 1, true]]);
  const decisive = standings(['a', 'b', 'c', 'd'], [game('a', 'b'), game('b', 'c'), game('d', 'a')]);
  assert.equal(decisive.find(row => row.id === 'a').rank, 2);
  assert.equal(decisive.find(row => row.id === 'b').rank, 3);
  assert.equal(standings(['a', 'b'], [game('a', 'b', [[4, 6], [4, 6]])])[0].id, 'b');
  assert.ok(standings(['a', 'b'], []).every(row => row.played === 0));
  assert.equal(standings(['a', 'b'], [game('a', 'b', [[7, 5], [3, 6], [6, 2]])])[0].gameDiff, 3);
});

test('placement groups align ranks and skip unavailable slots', () => {
  assert.deepEqual(placementGroups([['a', 'b'], ['c', 'd', 'e'], ['f', 'g'], ['h', 'i']]),
    [['a', 'c', 'f', 'h'], ['b', 'd', 'g', 'i'], ['e']]);
  assert.throws(() => placementGroups([['a'], ['b', 'a']]));
});

test('manual draws require a valid complete assignment and reasons for imbalance', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.throws(() => validateGroupAssignment(ids, [['a', 'b'], ['c', 'd', 'e', 'e']], 'Ausnahme'));
  assert.throws(() => validateGroupAssignment(ids, [['a', 'b'], ['c', 'd', 'e', 'f']]));
  assert.doesNotThrow(() => validateGroupAssignment(ids, [['a', 'b'], ['c', 'd', 'e', 'f']], 'Ausnahme'));
});

test('knockout pairs across groups and awards byes to the highest seeds', () => {
  assert.deepEqual(knockoutOpening([['a1', 'a2'], ['b1', 'b2']], 4), [
    { position: 1, home: 'a1', away: 'b2', rounds: 2 },
    { position: 2, home: 'b1', away: 'a2', rounds: 2 },
  ]);
  assert.deepEqual(knockoutOpening([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], 5)
    .filter(match => match.away === null).map(match => match.home), ['a1', 'b1', 'c1']);
  assert.equal(knockoutOpening([['a1', 'a2'], ['b1', 'b2']], 2)[0].rounds, 1);
  assert.throws(() => knockoutOpening([['a1', 'a2'], ['b1']], 4));
});
