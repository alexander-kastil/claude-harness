# Graph engineering: router, index, nodes, edges

A knowledge base the model reads is a routing structure, not a picture. Four parts, nothing else:

| Part | Job | Budget |
| --- | --- | --- |
| Router | read at the start of every session, says where things live | under 500 tokens |
| Index | one line per node, so the model knows where an answer is without opening it | one line, per node, no exceptions |
| Nodes | the actual knowledge, one idea per file | small enough to open cheaply |
| Edges | pointers to what a node genuinely depends on | ten sharp ones, not fifty |

## Mapped onto a Claude Code harness

| Part | Where it lives |
| --- | --- |
| Router | `~/.claude/CLAUDE.md` and the repo's `CLAUDE.md` |
| Index | the `description:` field of every skill and agent, all of which load every session |
| Nodes | `SKILL.md` routers and their `references/*.md` leaves |
| Edges | the delegation tables inside each `SKILL.md`, and `[[links]]` between memory files |
| State | the auto-memory directory and its `MEMORY.md` index |

The architecture is usually already right. What drifts is size, and it drifts in the index, because a description is the one place where writing more feels free and is not: every description is paid for on every turn, including the turns it has nothing to do with.

## The failure modes

- **Bloated router.** A `CLAUDE.md` that grew into a manual. It is dragged into context before anything happens. Cut to pointers and gotchas.
- **Fat index entries.** A `description` that has become a node: three sentences of capability, a feature list, an inventory of what the skill covers. The detail belongs in the leaf; the description keeps the routing and the trigger phrases.
- **Mega-notes.** One leaf covering ten topics, so using one line of it loads all ten. Split by idea.
- **Letting the model do the finding.** Finding is a matching problem, not a thinking problem.
- **No state.** Every session restarts from zero because nothing was written down.
- **Structure before content.** Empty scaffolding is busywork. Write the notes first, then engineer the routing.

## Retrieval as logic, not model calls

Five free steps, then one model call:

1. Strip the question to keywords.
2. Score candidates against the index alone. Open nothing.
3. Open only the best match, not three "just in case".
4. Read only the section that answers.
5. Follow one edge if that section points elsewhere.
6. Now run the model once, with the evidence already in hand.

Steps 1 to 5 cost nothing because they are logic. This is the same rule as budgeting before you retrieve: decide what to open before you open it.

## Prove it

Do not take a restructure on faith. Run the same questions before and after, and compare tokens, wall-clock, and whether the answer was actually right. This is the step that turns "it feels leaner" into a number.

Baseline measured on this harness, 2026-08-05, before any trim:

| Layer | Size | Note |
| --- | --- | --- |
| Router (`~/.claude/CLAUDE.md`) | 12,627 chars, ~3.2k tokens | against a 500-token budget |
| Index (101 skill descriptions) | 84,140 chars, ~21k tokens | 39 of 101 over 800 chars, worst 3,408 |
| State (`MEMORY.md`, 42 files) | 7,913 chars, ~2k tokens | |

About 26k tokens load before the first question, and the index is roughly 80% of it.

## Source

unicode (@unicodef1wn), "Graph Engineering: The 11-Step Roadmap From Obsidian Vault to Graph Fable 5 Can Actually Use", Jul 24 2026. The article frames it for an Obsidian vault; the structure is the same one a skill library has.
