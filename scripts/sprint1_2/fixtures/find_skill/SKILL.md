---
name: find-skill
description: Searches the local skill registry for a skill that matches the user's intent, suggests closest match by semantic similarity.
license: Apache-2.0
trigger_keywords: [skill, find, search, which, what skill]
---

# Find Skill

## When to use this skill

Use this skill when the user asks "do you have a skill for X?" or "which skill should I use to Y?".

This is a meta-skill: its purpose is to help the agent reason about its own capabilities catalog.

## Instructions

1. List all approved skills via `skill_list` tool.
2. For each skill, read its `description` and `trigger_keywords` from the frontmatter (no need to load the body).
3. Score each candidate by semantic similarity to the user's query (use the memory recall infrastructure if available).
4. Return the top 3 matches with:
   - Skill name
   - Why it matches (one sentence)
   - Confidence score (low / medium / high)
5. If no skill matches with confidence ≥ medium, suggest "skill not found, you can install one with `shinobi skill install <url>`".

## Safety

This skill is read-only. It never installs, removes, or executes skills — only lists and ranks them.

## Examples

User: "Do you have something to design a login screen?"
Agent (via this skill): "Top match: `interface-design` (high). It generates UX mockups including login flows."

User: "I want to set up Docker on this machine."
Agent: "Skill not found. You can install one with `shinobi skill install github:owner/docker-setup`."

## Output

Plain markdown list. Always present at most 3 candidates.
