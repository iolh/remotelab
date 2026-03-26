# Runtime Policy Layers

## Decision

Cue should not introduce a general model-strategy platform here.

The default layer should contain only runtime rules with clear, already-proven benefit.
Anything that depends on weak assumptions or missing product evidence stays out of the shipped default.

## Layer 1: Shipped Default

### Auxiliary downgrade

Status: shipped default

Scope:
- `session_label`
- `workflow_state`

Behavior:
- keep the current tool
- force the runtime onto the `efficient` tier
- force `thinking = false`

Implementation:
- `chat/summarizer.mjs`
- reuse `resolveRuntimeOverrideForTier('efficient', tool)` from `chat/models.mjs`

Why this is default:
- these tasks are lightweight classification / labeling work
- using the mainline runtime is wasted cost and latency
- the gain is immediate and does not depend on product experimentation

## Layer 2: Conditional Future

### Deliberate depth booster

Status: conditional future, not default

Candidate behavior:
- only consider upgrading runtime when the mainline was clearly not already on a strong setting
- examples:
  - mainline Codex `low` or `medium` → deliberate could try `high`
  - mainline Claude Sonnet → deliberate could consider Opus
  - mainline already strong/high → do not reroute just to "think again"

Reason it is not default:
- value depends on the source runtime baseline
- if the mainline already used a strong configuration, deliberate becomes repetition
- this needs real usage evidence before becoming policy

## Layer 3: Experimental Hypothesis

### Cross-provider verification

Status: experimental hypothesis, not default

Candidate idea:
- run verification on a different provider to buy a more independent view

Why it stays experimental:
- provider identity is a weak proxy for independence
- verification quality depends more on context quality, evidence collection, and rubric design
- same-context cross-provider runs may still share the same blind spots
- single-provider setups immediately collapse back to same-tool reruns

What would justify revisiting it:
- repeated real cases where verification misses same-provider blind spots
- evidence that cross-provider verification finds materially different issues
- a measurement plan that compares false negatives, false positives, latency, and cost

## Non-Goals

- no `model-strategy.mjs` registry
- no config file
- no hot reload
- no new API endpoints
- no default runtime heuristics in `workflow-engine.mjs`

## Product Alignment

Cue's differentiation is not "smart model routing".

The moat is the orchestration layer:
- when to suggest verification
- how verification prompts are framed
- how handoff conclusions are absorbed
- what gets auto-accepted versus held for user review

Auxiliary downgrade fits this direction because it reduces orchestration overhead without pretending model routing is the product.

## Current Code Shape

Shipped:
- `chat/summarizer.mjs` applies the auxiliary downgrade

Unchanged:
- `chat/workflow-engine.mjs` keeps the existing runtime inheritance for verify / deliberate sessions

## Next Revisit Trigger

Revisit runtime policy only after real usage produces one of these signals:
- auxiliary tasks still cost too much or feel too slow
- deliberate frequently needs more depth than the inherited runtime provides
- verification repeatedly misses issues that seem tied to model blind spots rather than prompt / evidence quality
