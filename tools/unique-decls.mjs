import assert from 'node:assert/strict';
import fs from 'node:fs';

// One declaration per name at the top level of app.ts.
//
// app.ts is one IIFE, and inside it a function declared twice is not an error:
// the later declaration wins and the earlier one is simply never called. The
// exercise bank's picker was declared openPicker, so was the plan's "Add to
// Thursday" picker a few thousand lines later, and for a fortnight every door
// into the bank opened the plan's sheet with a workout object for its label.
// Every harness pulls a function out of the source by its FIRST declaration, so
// each of them tested the function that never ran. This is the check that
// would have caught it: the source, not any one function, read for duplicates.
const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const seen = new Map();
const dupes = [];
src.split('\n').forEach((line, i) => {
  // Top-level declarations are indented exactly two spaces inside the IIFE;
  // helpers nested inside a function sit deeper and may legitimately share a
  // name with one another (a local `stop` in two gesture handlers).
  const m = /^  function ([A-Za-z_$][\w$]*)\(/.exec(line);
  if (!m) return;
  if (seen.has(m[1])) dupes.push(m[1] + ' (lines ' + seen.get(m[1]) + ' and ' + (i + 1) + ')');
  else seen.set(m[1], i + 1);
});
assert.deepEqual(dupes, [], 'app.ts declares these names more than once; the later one silently wins: ' + dupes.join(', '));
console.log('PASS every top-level function in app.ts is declared once (' + seen.size + ' names).');
