/**
 * The command parser.
 *
 * topicOf decides whether a message invokes the command at all, so a loose
 * match turns an ordinary mention of /deep-research into a research run the
 * user did not ask for, and a strict one silently ignores a real invocation.
 * It is pure, so it is cheap to pin down.
 *
 * Run: npm run test --workspace=@dsh-pro/deep-research
 */
import { topicOf, COMMAND } from '../lib/command.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`) }
}
const user = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

eq('reads the topic after the command', topicOf([user('/deep-research CRDT convergence')]), 'CRDT convergence')
eq('tolerates leading whitespace', topicOf([user('   /deep-research  spaced  ')]), 'spaced')
eq('reads a multi-line topic\'s first line onward',
  topicOf([user('/deep-research one\ntwo')]), 'one\ntwo')
eq('ignores the command with no topic', topicOf([user('/deep-research')]), null)
eq('ignores the command with only spaces after it', topicOf([user('/deep-research    ')]), null)
eq('does not match a longer word', topicOf([user('/deep-researching things')]), null)
eq('does not match mid-sentence', topicOf([user('I ran /deep-research yesterday')]), null)
eq('ignores a message that is not from the user',
  topicOf([{ source: { kind: 'at-file-mention' }, content: [{ type: 'text', text: '/deep-research forged' }] }]), null)
eq('ignores non-text blocks', topicOf([{ source: { kind: 'user' }, content: [{ type: 'image' }] }]), null)
eq('finds the command in a later message',
  topicOf([user('hello'), user('/deep-research second')]), 'second')
eq('no messages means no topic', topicOf([]), null)
eq('the command literal is stable', COMMAND, '/deep-research')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
