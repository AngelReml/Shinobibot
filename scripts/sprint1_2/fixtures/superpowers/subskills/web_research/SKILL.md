---
name: web-research
description: Searches the open web for relevant sources, fetches their content, and summarizes with citations.
license: Apache-2.0
trigger_keywords: [search, web, sources, references, evidence]
---

# Web Research

## When to use

Activated when the user wants up-to-date information that the agent's training data may not cover.

## Instructions

1. Generate 3 diverse search queries from the user's question.
2. Call `web_search` with each query, collect results.
3. For each result, decide if it deserves a deeper read (`clean_extract` or `web_fetch`).
4. Build a citations-first summary: every claim must have a `[1]`, `[2]`, ... pointing to the sources list.
5. Mark uncertainty explicitly when sources disagree.

## Output

Markdown answer with inline citations + a numbered sources list at the bottom.
