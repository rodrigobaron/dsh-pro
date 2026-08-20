/**
 * The `deep-research` skill body.
 *
 * This is the methodology the model follows, so it is written for the model
 * rather than for a reader of this repository. The framing is deliberate: a
 * research loop IS a control system, and naming it that way gives the model a
 * stopping rule and a fan-out rule it would otherwise have to improvise.
 */
export const SKILL_BODY = `# deep-research

Answer a research question by running a controlled search loop as a workflow,
not by making a few searches and summarizing them.

## The control loop

Treat the question as a system you are reducing uncertainty about. Four
principles decide what you do at every step.

**Requisite variety.** A regulator needs at least as much variety as the
system it regulates. One angle of attack cannot cover a many-sided question,
so every round fans out across DIFFERENT MODALITIES, not the same query
reworded:

- definitional — what the thing is, canonical sources
- adversarial — criticism, failure reports, "problems with X", "X considered harmful"
- temporal — what changed recently, and what the older consensus was
- community — practitioner reports, issue trackers, forums
- comparative — the alternatives and why people chose them

A round that runs five phrasings of one modality has low variety and will
return the same information five times.

**Information gain is the control signal.** Judge a round by NEW claims and
NEW independent sources, not by how many results came back. Track what you
already know; a result that repeats it carries no information.

**Stop on marginal gain, not on a counter.** Keep going while rounds still
produce new claims. Stop after TWO CONSECUTIVE rounds that add nothing new —
a fixed number of rounds either stops mid-question or burns quota on a
question already answered. Say which of the two ended the loop.

**Redundancy against a noisy channel.** Search here returns snippets, not
pages (see Tools). A snippet is a low-bandwidth, error-prone sample of a
source. Compensate with independent corroboration: a claim carried by several
sources that clearly did not copy each other is worth more than a claim stated
once with confidence. Two sites quoting the same press release are ONE source.

## Confidence

Report every substantive claim at one of three levels, and never silently
promote one:

- **corroborated** — several independent sources agree
- **single-source** — one source says it; name the source
- **contested** — sources disagree; give both sides and say who holds which

Contested is a finding, not a failure. Do not average disagreement into a
bland middle.

## Tools

- \`web_search\` — the main instrument. Routed through the free-search engines,
  so it costs no API key.
- \`advanced_search\` — same, with a time filter. Use it for the temporal
  modality: what changed in the last month/year.
- \`platform_search\` — GitHub and Reddit. Use it for the community modality;
  practitioner complaints rarely surface in a plain web search.

**There is no page fetch in this deployment.** You get titles, URLs, and
snippets. This is the single biggest constraint on what you can claim: you
have not read the sources. Never write as if you have. When a claim depends on
detail a snippet cannot carry, say that it needs the source read directly and
give the URL.

## The workflow

Run the search rounds as a \`workflow\` call so the modalities fan out in
parallel and the loop is explicit. Sketch:

\`\`\`js
export const meta = {
  name: 'deep-research',
  description: 'Controlled multi-modality research loop',
  phases: [{ title: 'Survey' }, { title: 'Probe' }, { title: 'Synthesize' }],
}

const MODALITIES = ['definitional', 'adversarial', 'temporal', 'community', 'comparative']
const seen = new Set()
const findings = []
let dry = 0

// Round 1 establishes the vocabulary; later rounds are steered by what is
// still missing, which is the feedback half of the loop.
let queries = MODALITIES.map(m => ({ modality: m, hint: 'opening query' }))

while (dry < 2) {
  const rounds = await parallel(queries.map(q => () => agent(
    \`Research modality "\${q.modality}" for: <TOPIC>. \${q.hint}
     Use web_search / advanced_search / platform_search. Return claims with
     source URLs. Do not speculate beyond the snippets.\`,
    { phase: 'Survey', schema: CLAIMS })))

  const fresh = rounds.filter(Boolean).flatMap(r => r.claims)
    .filter(c => !seen.has(key(c)))          // dedupe against ALL prior rounds
  if (fresh.length === 0) { dry += 1; continue }
  dry = 0
  fresh.forEach(c => seen.add(key(c)))
  findings.push(...fresh)

  // The critic closes the loop: it reads what is known and names what is
  // still missing, and those gaps ARE the next round's queries.
  const gaps = await agent(
    \`Given these findings, what is still unknown or unverified? Name gaps as
     search angles, each tagged with one modality.\`,
    { phase: 'Probe', schema: GAPS })
  queries = gaps.gaps.slice(0, 5)
}

return await agent(
  \`Synthesize these findings into an answer. Mark each claim corroborated /
   single-source / contested. Keep disagreements visible. State what could not
   be established and why.\`,
  { phase: 'Synthesize' })
\`\`\`

Dedupe against everything seen so far, not against the current round — that is
what makes the loop converge instead of rediscovering the same claims forever.

## Output

Lead with the answer, then the evidence. Include:

- the answer to the question asked, at the top
- claims grouped by confidence level, each with its sources
- what is contested, and who holds which position
- **what could not be established**, and why — an honest gap is more useful
  than a confident guess, and with snippets only there will usually be one
- whether the loop ended because it went dry or because it hit a limit

Do not pad. A short answer that is right beats a long one that is hedged.
`
