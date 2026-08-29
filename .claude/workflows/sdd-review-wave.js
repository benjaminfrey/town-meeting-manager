export const meta = {
  name: 'sdd-review-wave',
  description: 'Review a wave of completed SDD tasks in parallel, refute each finding adversarially, then look for interactions between the tasks',
  whenToUse: 'When two or more SDD tasks complete and need reviewing before integration. Pass args: [{task, base, head, worktree?, brief?, scope}]',
  phases: [
    { title: 'Review', detail: 'one reviewer per task diff' },
    { title: 'Refute', detail: 'independent skeptics per finding' },
    { title: 'Interactions', detail: 'what breaks only when these land together' },
  ],
}

// ── Why this workflow exists ────────────────────────────────────────────
// Hand-orchestrating this wave means reading N diffs serially and holding
// the interactions in one head. The interactions are the part that gets
// missed: each task is correct alone, and the pair is not. So the last
// phase is not a summary — it is its own investigation, and it is the
// reason this is a workflow rather than N separate review calls.

const FINDINGS = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['approved', 'approved-with-issues', 'changes-required'] },
    gatesPassed: { type: 'boolean' },
    testCount: { type: 'number' },
    claimsChecked: {
      type: 'array',
      description: 'Each claim the report made that you verified by executing, and what you found',
      items: {
        type: 'object',
        required: ['claim', 'held'],
        properties: {
          claim: { type: 'string' },
          held: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'summary', 'file', 'isDisclosure', 'provenByTest'],
        properties: {
          severity: { enum: ['critical', 'important', 'minor'] },
          summary: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          isDisclosure: {
            type: 'boolean',
            description: 'True if this lets someone read data they should not. Ranked first regardless of severity.',
          },
          provenByTest: {
            type: 'boolean',
            description: 'False if no test would fail were the fix reverted — an unproven fix.',
          },
          failureScenario: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
}

const INTERACTIONS = {
  type: 'object',
  required: ['interactions'],
  properties: {
    interactions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'tasks', 'severity'],
        properties: {
          summary: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' } },
          severity: { enum: ['critical', 'important', 'minor'] },
          evidence: { type: 'string' },
        },
      },
    },
    mergeOrder: { type: 'string', description: 'Recommended integration order and why' },
  },
}

const tasks = Array.isArray(args) ? args : []
if (tasks.length === 0) {
  log('No tasks passed. Pass args: [{task, base, head, worktree?, brief?, scope}]')
  return { error: 'no tasks' }
}

log(`Reviewing ${tasks.length} task(s): ${tasks.map((t) => t.task).join(', ')}`)

// ── Review each task, and refute its findings as soon as they exist ─────
// Pipelined, not barriered: a task whose review finishes early gets its
// findings refuted while the slower reviews are still running.
const reviewed = await pipeline(
  tasks,
  (t) =>
    agent(
      [
        `You are reviewing SDD task **${t.task}** in the town-meeting-manager repo.`,
        t.worktree ? `The work is in worktree: ${t.worktree}` : 'The work is on the current branch.',
        `Diff range: ${t.base}..${t.head}`,
        '',
        t.brief ? `The brief the implementer was given:\n${t.brief}` : '',
        t.scope ? `Scope of this review: ${t.scope}` : '',
        '',
        'METHOD — this matters more than coverage:',
        '- The implementer\'s report is a set of HYPOTHESES. Verify each by executing, not by reading.',
        '- Run the gates from .github/workflows/ci.yml. Use `npx turbo run test --force`.',
        '  `pnpm test --force` is NOT valid, and turbo cache has produced a false green in this repo twice —',
        '  if your run reports anything other than 0 cached, it proved nothing. Re-run.',
        '- Use DATABASE_URL="postgres://ben@localhost:5432/postgres". If you need a scratch database, give it a',
        '  unique name (others may be running concurrently) and drop it. Leave the `tmm_app` role in place.',
        '- For every "fixed" claim, find the test that would FAIL if the fix were reverted. If there is none,',
        '  the fix is UNPROVEN — set provenByTest false. That is a finding in itself.',
        '- Go beyond the implementer\'s own mutants. Weaken guards SEMANTICALLY: compare the wrong id, drop a',
        '  board argument, admit one tier too many. A test suite that survives a semantic weakening is pinning',
        '  presence, not meaning.',
        '- Rank disclosure issues first regardless of severity label. This product\'s core claim is records',
        '  compliance; a draft document that becomes readable is worse than a crash.',
        '',
        'Do not manufacture findings. If the work is sound, say so plainly and report an empty findings array.',
      ]
        .filter(Boolean)
        .join('\n'),
      { label: `review:${t.task}`, phase: 'Review', schema: FINDINGS, effort: 'high' },
    ),
  (review, t) => {
    if (!review) return null
    const real = (review.findings || []).filter((f) => f.severity !== 'minor')
    if (real.length === 0) return { task: t.task, review, confirmed: [] }
    // Each finding faces independent skeptics, each told to default to refuted.
    return parallel(
      real.map((f) => () =>
        agent(
          [
            `Try to REFUTE this review finding about the town-meeting-manager repo.`,
            `Task: ${t.task}. Diff range: ${t.base}..${t.head}.`,
            t.worktree ? `Worktree: ${t.worktree}` : '',
            '',
            `Claim: ${f.summary}`,
            `Location: ${f.file}${f.line ? `:${f.line}` : ''}`,
            f.failureScenario ? `Claimed failure: ${f.failureScenario}` : '',
            '',
            'Read the actual code and try to show the claim is WRONG — that the code is already correct, that',
            'the failure cannot occur, or that something upstream prevents it. Execute things; do not reason',
            'from the description alone. Default to refuted=true if you cannot substantiate the claim.',
          ]
            .filter(Boolean)
            .join('\n'),
          { label: `refute:${t.task}:${f.file}`, phase: 'Refute', schema: VERDICT },
        ),
      ),
    ).then((votes) => ({
      task: t.task,
      review,
      confirmed: real.filter((_, i) => votes[i] && !votes[i].refuted),
      refuted: real.filter((_, i) => votes[i] && votes[i].refuted),
    }))
  },
)

const results = reviewed.filter(Boolean)

// ── The phase that justifies the workflow ───────────────────────────────
// Each task can be correct alone and wrong together. Nobody reviewing a
// single diff can see that, because it is not in any one diff.
phase('Interactions')
const interactions = await agent(
  [
    'Several SDD tasks are about to be integrated into the same branch of the town-meeting-manager repo.',
    'Each was reviewed alone and found acceptable. Your job is the thing no single-diff review can see:',
    '**what breaks only when these land together.**',
    '',
    'The tasks:',
    ...tasks.map((t) => `- ${t.task}: ${t.base}..${t.head}${t.worktree ? ` (worktree ${t.worktree})` : ''}${t.scope ? ` — ${t.scope}` : ''}`),
    '',
    'Look specifically for:',
    '- The same file changed by two tasks in ways that merge cleanly but are not jointly correct.',
    '  A clean merge is not evidence of correctness — read both sides.',
    '- A filter, guard or predicate that one task adds and another bypasses.',
    '- Two tasks that each assume they own the same piece of state, config, route or nginx location.',
    '- A test that passes in each branch but would fail against the merged tree.',
    '- Tenancy specifically: these tasks touch how a request obtains its town from three different',
    '  directions (public/sessionless, pre-tenant, and background jobs). If two of them establish',
    '  tenancy differently for the same code path, that is the finding.',
    '',
    'Actually construct the merged tree in a scratch worktree and test it — do not reason about the merge',
    'abstractly. Use `npx turbo run test --force`; a cached result proves nothing. Clean up when done.',
    '',
    'Report an empty array if they genuinely compose. Do not invent interactions to seem thorough.',
  ].join('\n'),
  { label: 'interactions', phase: 'Interactions', schema: INTERACTIONS, effort: 'high' },
)

const confirmed = results.flatMap((r) => (r.confirmed || []).map((f) => ({ ...f, task: r.task })))
const unproven = results.flatMap((r) =>
  (r.review.findings || []).filter((f) => f.provenByTest === false).map((f) => ({ ...f, task: r.task })),
)

log(
  `${confirmed.length} finding(s) survived refutation; ${unproven.length} unproven fix(es); ` +
    `${(interactions?.interactions || []).length} cross-task interaction(s).`,
)

return {
  perTask: results.map((r) => ({
    task: r.task,
    verdict: r.review.verdict,
    gatesPassed: r.review.gatesPassed,
    testCount: r.review.testCount,
    claimsThatFailed: (r.review.claimsChecked || []).filter((c) => !c.held),
    confirmed: r.confirmed,
    refuted: (r.refuted || []).map((f) => f.summary),
  })),
  confirmed: confirmed.sort((a, b) => Number(b.isDisclosure) - Number(a.isDisclosure)),
  unproven,
  interactions: interactions?.interactions || [],
  mergeOrder: interactions?.mergeOrder,
}
