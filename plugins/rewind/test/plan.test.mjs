/**
 * The rewind planner, tested without a live session.
 *
 * planRewind is where an off-by-one silently shadows the wrong range — a
 * mistake that would remove more of the model's history than asked and cannot
 * be undone. It is pure, so it is cheap to pin down here.
 *
 * Run: npm run test --workspace=@dsh-pro/rewind (after a build).
 */
import { planRewind, markerText } from '../lib/index.js'
let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`) }
}

// A surface: user(9) assistant(12) toolresult(15) user(20) assistant(24)
const nodes = [9, 12, 15, 20, 24]

eq('rewind to the last user message shadows it and everything after',
  planRewind(nodes, 20), { start: 20, end: 24, shadowed: [20, 24] })
eq('rewind to the first user message shadows the whole surface',
  planRewind(nodes, 9), { start: 9, end: 24, shadowed: [9, 12, 15, 20, 24] })
eq('rewind to the final node shadows only itself',
  planRewind(nodes, 24), { start: 24, end: 24, shadowed: [24] })
eq('a seq that is not a surface node is refused',
  planRewind(nodes, 13), 'not-on-surface')
eq('an already-shadowed boundary is refused (it left the surface)',
  planRewind([20, 24], 9), 'not-on-surface')
eq('an empty surface is refused',
  planRewind([], 9), 'not-on-surface')

// The marker is what the model reads in place of the range.
eq('marker is singular for one node', markerText(1).includes('1 message that followed'), true)
eq('marker is plural for several', markerText(5).includes('5 messages that followed'), true)
eq('marker states files are untouched', markerText(2).includes('Files on disk were not changed'), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
