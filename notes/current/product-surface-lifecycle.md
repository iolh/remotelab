# Product Surface Lifecycle

This note captures a simple rule for keeping Cue small, useful, and honest as model capability changes.

## Core Rule

Shipping a feature does **not** mean committing to keep that feature forever.

Cue should prefer a clean, high-leverage surface over a large, accumulated one.

That means a shipped feature remains under review:

- does it solve a real pain in lived use?
- is the current UI/surface still the lightest way to solve it?
- did later product changes or model improvements make the feature less necessary?
- is the feature teaching the model/operator a good workflow, or is it freezing an old limitation into product surface?

## Default Review Loop

For any meaningful shipped product feature, keep a lightweight ongoing judgment:

- **keep** — the feature solves a real recurring problem and the surface still feels justified
- **iterate** — the problem is real, but the current surface is awkward, too heavy, or too manual
- **retire candidate** — the value is now weak, duplicated, superseded, or model capability drift has made the surface unnecessary
- **retired** — removed from the active product surface, while any durable lesson remains documented elsewhere

This review does not require formal A/B testing. In the current stage, owner use, friend use, and honest lived friction are enough to justify the judgment.

## What To Preserve From A Feature Task

When a feature task is distilled, keep only the parts that still matter long-term:

- the shipped slice / contract
- what pain it was solving
- current lifecycle judgment (`keep`, `iterate`, `retire candidate`, or `retired`)
- what evidence currently supports that judgment
- the smallest real follow-up list
- the canonical doc/backlog locations

Do **not** keep the full implementation-era speculation if it no longer helps future decisions.

## Why This Matters For Cue

Cue is not trying to become a large, rigid feature framework around the model.

The product should increasingly act as a set of clean tools and durable primitives that help a stronger model work better. As model capability improves, some older UI affordances or manual workflows may become transitional rather than permanent.

So entropy control is part of product design:

- avoid preserving every intermediate idea as permanent product surface
- prefer durable primitives over elaborate one-off UX scaffolding
- revisit older features when model capability or product direction changes the cost/benefit balance

## Worked Example: Session Fork

`Session fork` is worth keeping as a shipped v1 feature because it solves a real focus and branching pain.

But the current manual `Fork` action should not be treated as the final shape forever. It may later stay as a power-user tool, become lighter, or be partially absorbed by model-directed branching / sub-agent flows. That future possibility is a reason to keep the feature under review, not a reason to avoid shipping a useful narrow slice today.
