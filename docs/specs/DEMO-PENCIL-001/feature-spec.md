# DEMO-PENCIL-001 Feature Spec

## Title

About Page Support Hub Refresh

## Problem

The current About page is functional, but the support and community destinations
read as two flat lists. Users can find what they need, but the screen does not
signal priority well:

- update and legal context sit in one card
- community destinations sit in a generic list
- support destinations sit in another generic list
- the page does not clearly answer "where should I go next?"

## Goal

Refresh the About page so it feels more like a support hub:

- clearer hierarchy
- more intentional grouping
- better emphasis on the most useful next actions
- still grounded in the current Chatbox token system and component language

## User Story

As a Chatbox user opening the About page, I want to quickly understand:

- what version I am on
- where to get help
- where to leave feedback
- where to find community channels
- where to review legal and trust information

## Scope

This demo story covers:

- the About route only
- layout, grouping, hierarchy, and surface treatment
- preserving existing links and legal/update affordances

This demo story does not cover:

- new backend behavior
- new APIs
- new copy translation work beyond small implementation-safe adjustments
- changes to other routes

## Acceptance Criteria

1. The About page presents support and community destinations with clearer
   hierarchy than the current two-flat-list layout.
2. The existing destinations remain available:
   GitHub, RedNote, WeChat, Homepage, Survey, Feedback, Changelog, Email, FAQs.
3. The existing version area still shows the version and update action.
4. The existing privacy and terms links remain present.
5. The zh-Hans正版提示 warning remains visible for Simplified Chinese users.
6. The final implementation works on both small and large screens.
7. The final implementation stays aligned with the current Chatbox visual tokens
   in `src/renderer/static/globals.css`.

## Design Inputs

- Design brief:
  `docs/specs/DEMO-PENCIL-001/design-brief.md`
- Shared Pencil foundation:
  `design/system/design-system.lib.pen`
- Story design canvas:
  `design/stories/DEMO-PENCIL-001.pen`
- Review packet:
  `docs/specs/DEMO-PENCIL-001/pencil-review.md`

## Status

Design review seeded. Implementation intentionally paused until one variation is
approved.
