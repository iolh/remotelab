# Workflow Simplified

## Overview

RemoteLab's workflow layer is now event-driven.

What remains:

- `currentTask` on the mainline session
- lightweight `workflowState` and `workflowPriority`
- typed handoffs in `workflowPendingConclusions`
- post-run suggestions that can spawn auxiliary sessions

What was removed:

- `workflowDefinition`
- stage lists and `currentStageIndex`
- intake forms and pending intake persistence
- inline workflow declarations
- auto-router mode selection
- task contract / trace / metric trees
- `workflowAutoTriggerDisabled`

The system now optimizes for a small number of durable primitives instead of a large predeclared state machine.

## Core Loops

### 1. Direct Execute

For small work:

1. user sends a message
2. session starts a run
3. run completes

No workflow staging is materialized.

### 2. Mainline + Verification

For normal delivery work:

1. mainline session executes
2. completed run may surface `workflowSuggestion: suggest_verification`
3. accepting the suggestion spawns a verification session
4. verification session returns `verification_result`
5. mainline stores the result in `workflowPendingConclusions`
6. result is auto-absorbed or left for human decision

### 3. Mainline + Deliberation

For ambiguous or risky work:

1. mainline session executes or reaches a decision point
2. system can surface `workflowSuggestion: suggest_decision`
3. accepting the suggestion spawns a deliberation session
4. deliberation session returns `decision_result`
5. mainline absorbs the recommendation or pauses for a human call

### Parallel Work

Parallel work is no longer a dedicated workflow mode.
It is simply multi-session fan-out plus typed handoff back into the mainline when needed.

## Typed Handoff Contract

Two result types are first-class:

- `verification_result`
- `decision_result`

Each handoff is appended into `workflowPendingConclusions` on the target session.
Valid statuses are:

- `pending`
- `needs_decision`
- `accepted`
- `ignored`
- `superseded`

Supersede rule:

- a newer handoff from the same `sourceSessionId + handoffType` automatically supersedes the prior unresolved one
- cross-source handoffs do not supersede each other automatically

## Suggestions

Suggestions are now lightweight and local:

- they are derived after run completion
- they do not depend on stage definitions
- accepting a suggestion directly creates and starts the auxiliary session
- dismissing a suggestion only clears the suggestion state

## Prompt Contract

Manager prompt construction now injects only:

- manager turn policy
- routing hint
- active agreements
- `currentTask`
- open pending handoffs

There is no stage prompt block anymore.

## API / UI Shape

Kept in session payloads:

- `currentTask`
- `workflowState`
- `workflowPriority`
- `workflowSuggestion`
- `workflowPendingConclusions`
- `handoffTargetSessionId`

Stripped from outward-facing session payloads:

- `workflowDefinition`
- `workflowMode`
- `workflowTaskContract`
- `workflowTaskTrace`
- `workflowTraceBridge`
- `workflowAutoRoute`
- `workflowAutoTriggerDisabled`
- `pendingIntake`

UI simplification:

- no workflow mode selector
- no stage timeline
- no intake panel
- keep suggestion actions
- keep pending conclusions
- keep workflow state / priority display

## Module Boundaries

- `chat/session-manager.mjs`: session/run orchestration shell
- `chat/workflow-engine.mjs`: event-driven workflow and handoff logic
- `chat/prompt-builder.mjs`: prompt assembly and fork context handling
- `chat/context-compaction.mjs`: compaction queue and worker flow
- `chat/follow-up-queue.mjs`: queued follow-up dispatch
- `chat/run-completion-suggestions.mjs`: suggestion heuristics after run completion

## Practical Rule

Treat workflow as session orchestration plus typed results, not as a stage machine.
