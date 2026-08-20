/**
 * The workflow fold, tested without a browser.
 *
 * The fold is where a mis-paired agent-end silently attributes a failure to
 * the wrong member, or a run-end leaves members spinning forever — both of
 * which look like a UI bug and are actually arithmetic. It is pure, so it is
 * cheap to pin down.
 *
 * Run: npm run test --workspace=@my-dsh/workflow (after a build).
 */
import { apply, byPhase, progress, seed } from '../lib/fold.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`) }
}
const ev = (type, time, data) => ({ type, seq: time, time, data })

let s = seed(ev('tool-workflow/run-start', 1000, { runId: 'r1', name: 'review-changes' }))
eq('seeds name and start time', [s.name, s.startedAt, s.status], ['review-changes', 1000, 'running'])

s = apply(s, ev('tool-workflow/agent-start', 1100, { runId: 'r1', seq: 1, label: 'review:bugs', phase: 'Review', childId: 'c1' }))
s = apply(s, ev('tool-workflow/agent-start', 1200, { runId: 'r1', seq: 2, label: 'review:perf', phase: 'Review', childId: 'c2' }))
s = apply(s, ev('tool-workflow/agent-start', 1300, { runId: 'r1', seq: 3, label: 'verify:a', phase: 'Verify', childId: 'c3' }))
eq('members accumulate', s.members.map(m => m.label), ['review:bugs', 'review:perf', 'verify:a'])
eq('nothing settled yet', progress(s), { done: 0, total: 3, failed: 0 })

s = apply(s, ev('tool-workflow/agent-end', 1500, { runId: 'r1', seq: 2, outcome: 'ok' }))
eq('an end settles only its own member', s.members.map(m => m.status), ['running', 'ok', 'running'])
eq('and records its duration', s.members[1].endedAt - s.members[1].startedAt, 300)

s = apply(s, ev('tool-workflow/agent-end', 1600, { runId: 'r1', seq: 1, outcome: { kind: 'error', message: 'boom' } }))
eq('a failure keeps its reason', [s.members[0].status, s.members[0].error], ['failed', 'boom'])
eq('progress counts failures separately', progress(s), { done: 2, total: 3, failed: 1 })

eq('a duplicate agent-start is ignored',
  apply(s, ev('tool-workflow/agent-start', 1700, { runId: 'r1', seq: 1, label: 'dupe' })).members.length, 3)
eq('an unrelated event returns the same state',
  apply(s, ev('turn/end', 1800, {})) === s, true)

const ended = apply(s, ev('tool-workflow/run-end', 2000, { runId: 'r1', stopReason: 'completed' }))
eq('run-end settles the run', [ended.status, ended.endedAt], ['ok', 2000])
eq('members still open at run-end are interrupted, not left running',
  ended.members.map(m => m.status), ['failed', 'ok', 'interrupted'])

eq('phases group in first-seen order, unphased last',
  byPhase(ended).map(g => [g.phase ?? null, g.members.length]), [['Review', 2], ['Verify', 1]])

const mixed = apply(seed(ev('tool-workflow/run-start', 1, { runId: 'r2', name: 'w' })),
  ev('tool-workflow/agent-start', 2, { runId: 'r2', seq: 1, label: 'lone' }))
eq('an unphased member groups under no phase', byPhase(mixed).map(g => g.phase ?? null), [null])

const cancelled = apply(seed(ev('tool-workflow/run-start', 1, { runId: 'r3', name: 'w' })),
  ev('tool-workflow/run-end', 9, { runId: 'r3', stopReason: 'cancelled' }))
eq('a cancelled run reads cancelled', cancelled.status, 'cancelled')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
