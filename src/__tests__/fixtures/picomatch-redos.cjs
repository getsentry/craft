/* global require, process */
// GHSA-fc5q-39xc-vjpf: single-branch repeated extglobs nest an unbounded
// quantifier. Runs in a child process because a backtracking regex blocks
// its own event loop. Usage: node picomatch-redos.cjs <path to picomatch>
const picomatch = require(process.argv[2]);
const globs = ['+(*)', '+(*a)', '*(*a)', '+(a*)b', '+(*[a])', '+(@(*a))'];
const inputs = ['a'.repeat(50000) + '!', 'a'.repeat(50000) + '/'];
for (const glob of globs) {
  for (const input of inputs) {
    picomatch(glob)(input);
  }
}
