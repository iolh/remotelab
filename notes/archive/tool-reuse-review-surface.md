# Tool Reuse Review Surface — Session-First Direction

> Status: corrected design draft after product-model review.
> Purpose: define how the existing offline tool-call analyzer should integrate into Cue while preserving the app's core abstraction: layered session lists plus Markdown-native interaction.

---

## Core Correction

The earlier framing was too heavy.

The correct product model is:

- Markdown remains the first-class interaction format
- rich rendering is only an extension of Markdown, not a parallel content model
- a generated daily or weekly report is still just a normal session
- the user reviews it by opening that session in the existing session list
- the product should reuse the same grouping / hierarchy abstraction instead of adding a separate review surface

Short form:

```text
tool reuse report = automated session + markdown report
```

That means the review experience should stay inside the same product grammar the user already understands.

---

## Why This Matters

Cue's cleanest abstraction is not "many specialized surfaces".

It is:

- one conversation/session primitive
- grouped into lightweight layers in the sidebar
- rendered primarily as Markdown in the main pane

If the tool-reuse flow introduces:

- a new review resource model
- a separate candidate pane
- a special sidebar tab

then the feature becomes architecturally louder than its value.

That is the wrong direction.

---

## Correct Product Framing

The feature should be framed as:

- the system periodically opens an automated session
- the system writes a Markdown report into that session
- the user later opens that session and reviews it like any other conversation
- follow-up decisions can happen in the same session thread

This keeps the product mentally coherent.

The user does not need to learn a new surface.

They only need to notice that some sessions are system-generated reports.

---

## Markdown-First Rule

The canonical artifact the user reviews should be Markdown.

That implies:

- report titles should be normal session titles
- report bodies should be readable Markdown
- tables, headings, task lists, and expandable UI all derive from Markdown-compatible rendering
- any richer display should still be a Markdown extension, not a competing structured UI contract

Machine-readable JSON sidecars are still useful, but they are implementation support artifacts, not the primary user-facing abstraction.

So the split should be:

- **primary review artifact**: Markdown session content
- **support artifact**: JSON sidecar for tooling and future automation

---

## What Already Exists

The current system already has most of the needed pieces.

### Analyzer layer

The current analyzer already provides:

- daily and weekly windowed scans
- repeated tool-call clustering
- repeated multi-step sequence detection
- Markdown and JSON output artifacts

### Product layer

Cue already provides:

- session creation
- session naming
- session grouping via `group` and `description`
- session list rendering in grouped layers
- Markdown-native conversation display
- automated maintenance sessions triggered by the server-side workflow

That means phase 2 should be a very light integration step, not a new product subsystem.

---

## Recommended Architecture

### 1. Keep the analyzer reusable

The analyzer core should stay:

- offline
- file-based
- reusable outside Cue
- focused only on extracting patterns from tool calls

It should continue to emit:

- JSON sidecar
- Markdown source material or Markdown-ready summaries

### 2. Treat the report as a session, not a new entity type

A report should be created as an ordinary Cue session with:

- a normal session title
- a stable display group
- a concise description
- a Markdown body generated inside the conversation

The session is the review container.

The session history is the audit trail.

The sidebar list is the discovery surface.

### 3. Use hierarchy, not a new tab

The review flow should appear in the existing session list hierarchy.

For example:

- `Daily Review`
- `Weekly Review`
- or one broader stable group such as `Review Reports`

The exact naming is less important than the rule:

> system-generated reports live in the same grouped session list as everything else.

### 4. Keep review conversational

If the user wants to act on a report, they should be able to do it in the same session:

- ask follow-up questions
- request a tighter summary
- ask the agent to turn one candidate into a prompt/script/skill
- dismiss patterns informally by conversation

This keeps the review loop aligned with the product's strongest primitive: conversation.

---

## Minimal Metadata Model

The earlier proposal over-modeled reports and candidates as first-class product resources.

The lighter and more correct version is:

- **session** stays primary
- **group** provides the report layer in the sidebar
- **description** helps keep grouping meaningful
- **sidecar JSON** remains available for tooling or later automation

If extra metadata is needed, keep it minimal and session-adjacent.

Examples of acceptable lightweight metadata:

```json
{
  "reportKind": "daily",
  "reportWindow": {
    "startDate": "2026-03-09",
    "endDate": "2026-03-09",
    "days": 1
  },
  "sidecarJsonPath": "...",
  "sidecarMarkdownPath": "..."
}
```

But that metadata should support the session experience, not replace it.

---

## Recommended Review Flow

### Daily flow

1. server-owned workflow triggers the analyzer
2. analyzer produces sidecar artifacts
3. Cue opens or updates a report session
4. the agent writes a Markdown daily report into that session
5. the session appears under the report layer in the normal session list
6. the user opens it later and reviews it like any other conversation

### Weekly flow

1. server-owned workflow triggers a wider analysis window
2. a weekly report session is created or updated
3. the report emphasizes only stable repeated patterns
4. the user reviews it in the same way as the daily report session

---

## What the Markdown Report Should Contain

The report itself should be sufficient for review without opening raw JSON.

Suggested report structure:

```md
# Daily Tool Reuse Report — 2026-03-09

## Summary
- sessions analyzed
- tool calls analyzed
- strongest repeated patterns

## Top Repeated Patterns
### 1. [pattern title]
- frequency
- session count
- why it may matter
- suggested direction: prompt / script / skill

#### Example Calls
```sh
...
```

## Repeated Sequences
...

## Recommended Next Actions
- watch
- dismiss
- promote
```

The point is not to mirror the entire JSON report.

The point is to produce a clean Markdown reading surface that feels native inside the app.

---

## What Should Not Be Added

To preserve abstraction cleanliness, phase 2 should avoid:

- a dedicated `Insights` sidebar tab
- a separate candidate resource UI
- a new review-specific content model parallel to Markdown
- heavy report registries that duplicate the session model
- special-case product flows that bypass the normal conversation/session abstraction

These would all make the feature heavier than necessary.

---

## What Still Belongs In The Server

The analyzer should stay reusable.

But the trigger path still belongs in the server-owned workflow because that enables:

- stable scheduling
- natural session creation
- automatic grouping in the existing sidebar hierarchy
- existing persistence and auth behavior
- future reuse of status and run plumbing

The right split is therefore:

- **portable**: extraction, clustering, sequence analysis, artifact generation
- **Cue-native**: job triggering, session creation, group placement, Markdown publication

---

## Gap From Current State

The current system already has:

- offline analyzer core
- sidecar artifacts
- automated maintenance-triggered sessions

The remaining gaps are now much smaller than previously described.

The real missing pieces are:

1. **stable report grouping in the existing session hierarchy**
2. **clear Markdown report structure optimized for review**
3. **light session-level metadata for report window/source if needed**
4. **a cleaner server-owned trigger path over time**

That means phase 2 is mostly a publication-and-placement problem, not a new UI/platform problem.

---

## Recommended Delivery Sequence

### Step 1 — Session-first placement

Make daily and weekly review runs create sessions with stable `group` and `description` metadata.

Ship goal:

- reports appear in the existing grouped session list with no new UI surface

### Step 2 — Better Markdown output contract

Tighten the maintenance/report prompt so the generated report is a durable Markdown reading surface, not just an execution summary.

Ship goal:

- reopening the report session later still feels useful and self-contained

### Step 3 — Optional light metadata

If needed, attach report-window/source metadata to the session or its sidecar linkage.

Ship goal:

- the system can distinguish daily vs weekly reports without inventing a new top-level product object

### Step 4 — Server-owned publication path

Gradually move more of the scheduling and publication logic behind the server workflow while preserving the same session-first abstraction.

Ship goal:

- operationally cleaner generation, same user-facing mental model

---

## Risks To Watch

### 1. Weak Markdown reports

If the generated Markdown is noisy or too operational, the session will not be a good review surface.

Mitigation:

- explicitly optimize the report prompt for readability and reviewability

### 2. Report sessions becoming clutter

If too many automated sessions are created with poor naming or grouping, the session list gets messy.

Mitigation:

- use stable grouping
- keep titles predictable
- bias daily reports toward concise summaries

### 3. Hiding too much in JSON

If important review signal only exists in sidecar JSON, the user-facing experience stops being Markdown-first.

Mitigation:

- treat JSON as support data only
- ensure the session Markdown carries the real review value

---

## Final Recommendation

The corrected near-term direction is:

> keep the analyzer reusable and offline, but publish its results as ordinary grouped sessions rendered and reviewed through Markdown.

That preserves the product's cleanest abstraction:

- hierarchy in the session list
- session as the review container
- Markdown as the primary interaction medium

This is lighter, more coherent, and more aligned with Cue's existing product model than introducing a separate report surface.
