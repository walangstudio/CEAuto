/**
 * planner.js — the LLM planner step (Pillars 3 + 5).
 *
 * A task flagged `plan` is not executed directly; instead the agent is asked to
 * DECOMPOSE it into a subtask DAG. The decomposition rides the existing Pillar 5
 * directive path: the agent emits a fenced ```ceauto block, the llm executor
 * parses it (delegation.parseDirective), and the runner spawns the children
 * (within the role's can_delegate_to authority + depth/fan-out caps) where the
 * DAG scheduler drains them. So the planner adds no new execution machinery —
 * just the instruction that turns "do the work" into "plan the work".
 *
 * Inter-subtask ordering: list subtasks in execution order and let a later one
 * `depends_on` the *title* of an earlier sibling; the runner maps sibling titles
 * to the new child ids (forward order only).
 */

const DEFAULT_MAX_SUBTASKS = 5;
const DEFAULT_AGENTS = ['researcher', 'coder', 'analyst', 'writer', 'ops', 'security', 'comms'];

/**
 * The instruction appended to a planning task so the agent returns a directive
 * instead of doing the work.
 * @param {{agents?:string[], maxSubtasks?:number}} [opts]
 */
function buildPlanInstruction({ agents, maxSubtasks = DEFAULT_MAX_SUBTASKS } = {}) {
  const roster = (agents && agents.length ? agents : DEFAULT_AGENTS).join(', ');
  return [
    '## PLANNING MODE',
    'Do NOT perform this task yourself. Break it into the smallest set of ' +
      `subtasks (2–${maxSubtasks}) that together accomplish it.`,
    'Respond with ONLY a fenced ```ceauto block — no prose before or after:',
    '```ceauto',
    '{ "subtasks": [ { "title": "short title", "description": "what to do", "agent": "<agent>", "depends_on": [] } ] }',
    '```',
    `Pick each subtask's agent from: ${roster}.`,
    'List subtasks in execution order. Use depends_on only when a subtask truly ' +
      'needs an earlier one first — reference that earlier subtask by its exact title.',
  ].join('\n');
}

module.exports = { buildPlanInstruction, DEFAULT_MAX_SUBTASKS, DEFAULT_AGENTS };
