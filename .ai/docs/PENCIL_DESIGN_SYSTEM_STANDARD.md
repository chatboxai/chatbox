# Pencil Design System Standard

Use this document to decide whether the Pencil foundation is still a starter
library or is truly comprehensive.

## Truthful Labels

- `starter`:
  tokens plus a few sample components
- `working`:
  enough shared pieces to support current stories, but major system categories
  are still missing
- `comprehensive`:
  the library can support most story work without rebuilding core UI language
  from scratch

Do not call a library `comprehensive` unless the checklist below is mostly
green.

## Comprehensive Checklist

### 1. Foundations

- themes or mode strategy
- semantic color tokens
- spacing scale
- radius scale
- typography scale
- elevation or surface-depth strategy

### 2. Interaction States

- default
- hover
- focus
- active or pressed
- selected
- disabled
- loading where relevant
- destructive or warning states where relevant

### 3. Primitives

- primary and secondary buttons
- icon buttons
- badges or chips
- dividers
- avatars or media containers if the app uses them
- field labels and helper text

### 4. Form Controls

- text input
- textarea
- select or combobox
- checkbox
- radio
- switch or toggle
- validation and error presentation

### 5. App Chrome

- page shell
- header or toolbar shell
- sidebar or navigation item patterns
- tab or segmented controls when the app uses them
- modal, drawer, or panel shells
- menu or popover anchors when relevant

### 6. Content Patterns

- cards
- list rows
- resource tiles
- stat tiles
- tables or dense list patterns when relevant
- empty states
- notices, warnings, and alerts

### 7. Layout Templates

- one-column page
- two-column page
- split-pane or dashboard shell when relevant
- settings-form shell
- dialog-body layout

### 8. Pencil-Native Reuse

- reusable components instead of raw duplication
- slots for container patterns
- instance overrides via descendants where useful
- library organization that future stories can import directly

### 9. Code Alignment

- tokens sourced from code when possible
- shared app surfaces imported from code into Pencil when possible
- export prompts constrained to the real app stack
- code and Pencil tokens not drifting silently

## Required Process Rules

1. If the foundation is partial, say so in the review packet.
2. Extend the design system before building a story-specific one-off pattern.
3. Story variations should use real library-backed components where possible.
4. If a variation relies heavily on placeholder geometry, label it as
   wireframe-grade, not production-grade.
5. Keep a visible gap list for the next library pass.

## Minimum Expectation For This Repo

For Chatbox, a healthy near-term Pencil foundation should at least cover:

- page shells
- settings and support surface shells
- list rows
- buttons and chips
- notice banners
- resource or stat tiles
- modal or drawer shells
- navigation primitives
- form primitives

Anything below that is still a starter or working foundation, not a
comprehensive system.
