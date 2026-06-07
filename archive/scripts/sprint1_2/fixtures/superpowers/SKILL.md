---
name: superpowers
description: Meta-skill that orchestrates sub-skills for multi-step research and content production workflows.
license: Apache-2.0
trigger_keywords: [research, multi-step, workflow, deep dive, comprehensive]
---

# Superpowers

## When to use this skill

For complex requests that benefit from breaking down into specialized sub-skills, such as:

- Multi-source research synthesis
- Long-form content production with sources
- Multi-domain analysis (technical + market + legal)

## Architecture

Superpowers is a **container skill**. It does not act directly; it delegates to sub-skills found in `subskills/`. Each sub-skill is a normal Anthropic Skill (SKILL.md + optional assets) that the orchestrator can invoke.

## Workflow

1. Parse the user's request and identify the relevant sub-skills.
2. For each sub-skill:
   - Read its SKILL.md
   - Pass the relevant slice of the user's request
   - Collect the output
3. Synthesize the outputs into a single coherent response, citing the sub-skill that produced each part.

## Currently bundled sub-skills

- `web_research`: searches and summarizes external sources

## Adding a sub-skill

1. Create a new directory under `subskills/<your-skill-name>/`
2. Add a `SKILL.md` with frontmatter (`name`, `description`, `trigger_keywords`)
3. Re-install superpowers to revalidate the bundle

## Limits

- Maximum sub-skill depth: 2 levels (sub-skill of a sub-skill is rejected).
- Each sub-skill is audited individually before being trusted.

## Output

Synthesized markdown answer with a "Sources" section listing the sub-skills used.
