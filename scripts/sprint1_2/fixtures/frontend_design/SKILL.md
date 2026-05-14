---
name: frontend-design
description: Designs and reviews frontend component architecture in React, Vue, or Svelte with emphasis on state management and accessibility.
license: MIT
trigger_keywords: [react, vue, svelte, component, frontend, state]
---

# Frontend Design

## When to use this skill

Use this skill when the user wants help with:

- Designing a new React/Vue/Svelte component tree
- Reviewing existing component decomposition for over-coupling
- Choosing between local state, context, store (Redux/Pinia/Svelte stores)
- Establishing prop drilling vs context boundaries

## Workflow

1. Read the component(s) involved with the `read_file` tool.
2. Map the data flow: where state originates, where it is read, where it is mutated.
3. Identify cycles or implicit dependencies.
4. Propose a refactor with explicit boundaries:
   - Pure presentational components at the leaves
   - Stateful container components above them
   - Side effects isolated in hooks/composables
5. Check accessibility: keyboard navigation, focus management, ARIA roles, color contrast.

## State management decision matrix

| Scope | Recommendation |
|---|---|
| Single component | useState / ref |
| Two siblings | Lift to parent |
| 3+ deep, single tree | Context (React) / provide-inject (Vue) |
| Global, cross-tree | Store (Zustand, Pinia, Svelte writable) |

## Avoid

- One global store for everything ("redux for hello world")
- Prop drilling through 4+ levels
- Side effects inside render functions
- Direct DOM manipulation when the framework offers refs

## Output

Return: (1) Current state diagram, (2) Issues identified, (3) Proposed refactor with file-level changes, (4) Migration steps.
