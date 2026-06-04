/**
 * delegation.js — parse an agent's structured delegation directive (Pillar 5).
 *
 * An executor's text output may carry a fenced directive the agent uses to
 * decompose its work or escalate. The runner turns these into child tasks
 * (within the role's delegation authority + depth/fan-out caps) or an
 * escalation up the reporting line.
 *
 *   ```ceauto
 *   { "subtasks": [ { "title": "...", "agent": "coder", "depends_on": [] } ],
 *     "escalate": { "reason": "needs a strategic call" } }
 *   ```
 *
 * Parsing is best-effort and total: malformed/absent directives yield null, so a
 * normal answer is never mistaken for a directive.
 */

const FENCE = /```ceauto\s*\n([\s\S]*?)```/i;

function parseDirective(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(FENCE);
  if (!m) return null;
  let doc;
  try {
    doc = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  const subtasks = Array.isArray(doc.subtasks)
    ? doc.subtasks
      .filter(s => s && typeof s === 'object' && (s.title || s.description))
      .map(s => ({
        title: String(s.title || s.description).slice(0, 200),
        description: s.description ? String(s.description) : undefined,
        agent: typeof s.agent === 'string' ? s.agent : undefined,
        depends_on: Array.isArray(s.depends_on) ? s.depends_on.filter(x => typeof x === 'string') : undefined,
      }))
    : [];

  const escalate = doc.escalate && typeof doc.escalate === 'object'
    ? { reason: String(doc.escalate.reason || 'escalation requested') }
    : null;

  if (!subtasks.length && !escalate) return null;
  return { subtasks, escalate };
}

module.exports = { parseDirective };
