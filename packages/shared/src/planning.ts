/**
 * Epic 4's contract (story 4.1's tracer, frozen by story 4.2): the catalog of
 * a project's installed BMad Method modules, skills and agents, starting a
 * planning session on one, the project's tickets as `tickets.py` reports
 * them, a ticket's detail and status change, BMad Method's setup in a
 * project, and the per-project script trust. Every shape and user-facing
 * text of the Plan and Board pages, the setup panel and the trust prompt
 * lives here, so entries 4.3 to 4.11 build against one file.
 *
 * Nothing here names a skill (AD-12): the catalog is read from the repo's
 * installed metadata, and the agent adapter turns a skill name into the
 * text that invokes it. No UI text here holds an em or en dash.
 */

// Split by entry 4.12 into siblings, each re-exported here under the same names.
export * from './planning-catalog.js';
export * from './planning-board.js';
export * from './planning-setup.js';
export * from './planning-text.js';
