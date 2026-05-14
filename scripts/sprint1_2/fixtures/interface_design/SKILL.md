---
name: interface-design
description: Generates UX/UI mockups and component specifications for web and mobile interfaces using established design principles.
license: Apache-2.0
trigger_keywords: [ui, ux, interface, mockup, design, wireframe]
---

# Interface Design

## When to use this skill

Activate this skill when the user requests:

- UI mockups for a new screen or component
- Wireframes for an application flow
- Design critique on an existing interface
- Component spec sheets (sizes, states, accessibility)

## Instructions

1. Clarify the target platform (web responsive, native iOS, native Android) and the user's design system (Material, Apple HIG, Tailwind, custom).
2. Identify the primary user action on the screen. Place it visually first.
3. Apply the 60-30-10 color rule unless the user provides a palette.
4. Produce a textual wireframe using ASCII boxes or call out the layout regions.
5. List accessibility considerations: contrast ratio, focus order, ARIA roles.

## Anti-patterns to avoid

- Floating action buttons that overlap text content
- Hamburger menus on desktop unless the nav has > 7 items
- Bottom sheets that occupy more than 80% of the viewport

## Examples

A login screen mockup:

```
+--------------------------------+
|         App Logo               |
|                                |
|   [ Email                  ]   |
|   [ Password               ]   |
|                                |
|         [ Sign in ]            |
|                                |
|   Forgot password? · Sign up   |
+--------------------------------+
```

## Output format

Return a markdown response with: (1) Layout description, (2) Component list, (3) Accessibility notes, (4) Tokens (colors, spacings) when relevant.
