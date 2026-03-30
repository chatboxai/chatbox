# Variables

- Source: https://docs.pencil.dev/core-concepts/variables
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Variables

## What are Variables?

Variables in Pencil work similar to CSS custom properties or design tokens.

You define HEX codes for colors, numbers for spacing, border radii, and sizes, or strings for font names — once. Then you use them throughout your design.

When you change a variable in the variables panel, it updates everywhere it’s used.

## Creating Variables

- Manually — Define variables directly in Pencil and set values for different themes. Click the variables icon in the toolbar to open the panel.
- From CSS — Ask the AI agent to create variables from your globals.css . It automatically extracts colors, spacing, and fonts.
- From Figma — Paste a screenshot of the variables table and ask the AI to set them up in Pencil. You can also simply copy and paste individual token values from Figma.

## Using Variables

- Apply to elements — Instead of hardcoding values, reference variables. When a variable changes, every element using it updates automatically.
- Theming — Add a new column in the variables panel to create themes like light and dark mode. Switch between themes in the properties panel to see how your designs adapt.

## Sync with Code

You can keep variables in sync between Pencil and your codebase. Ask the AI assistant to update CSS variables based on your Pencil file, or import CSS changes back into Pencil. This enables a two-way design-to-code workflow.
