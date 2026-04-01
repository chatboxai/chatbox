# DEMO-PENCIL-001 Pencil Review

## Story

About Page Support Hub Refresh

## Artifact References

- Feature spec:
  `docs/specs/DEMO-PENCIL-001/feature-spec.md`
- Technical plan:
  `docs/specs/DEMO-PENCIL-001/technical-plan.md`
- Design brief:
  `docs/specs/DEMO-PENCIL-001/design-brief.md`
- Foundation library:
  `design/system/design-system.lib.pen`
- Story canvas:
  `design/stories/DEMO-PENCIL-001.pen`

## Tooling Status

- Pencil docs were re-synced locally on 2026-03-30 before this foundation pass
- Pencil desktop app is present locally at `/Applications/Pencil.app`
- Pencil MCP is the default bridge for this repo and is the readiness signal
  that matters for story work
- Direct shell `pencil` CLI was not used in this exec environment, so
  verification here relied on synced docs plus `.pen` JSON validation
- Because of that, this packet includes supplemental SVG previews instead of
  exported live Pencil screenshots
- The `.pen` files are still checked in and ready to open in Pencil for the next
  interactive pass

## Design-Brief Summary

- Audience:
  existing Chatbox users looking for help, trust details, or community routes
- Desired feeling:
  guided, trustworthy, calm
- Feelings to avoid:
  dashboard-like, promotional, or flat settings-list energy
- Layout metaphor:
  support concierge wall with clear route groups
- Copy direction:
  concrete route names and action labels, with real draft copy for
  design-grade review

## Foundation Used

The design foundation is seeded from real Chatbox tokens in
`src/renderer/static/globals.css`:

- light and dark surface tokens
- text colors
- brand, warning, success, and error accents
- spacing scale
- radius scale

Foundation maturity: comprehensive, first pass

The foundation library now includes:

- `ds_field_label_stack`
- `ds_button_primary`
- `ds_button_secondary`
- `ds_button_destructive`
- `ds_button_disabled`
- `ds_button_loading`
- `ds_button_primary_pressed`
- `ds_icon_button`
- `ds_icon_button_hover`
- `ds_page_shell`
- `ds_page_header`
- `ds_toolbar_shell`
- `ds_sidebar_shell`
- `ds_nav_item`
- `ds_nav_item_selected`
- `ds_session_row`
- `ds_session_row_selected`
- `ds_menu_item`
- `ds_menu_item_danger`
- `ds_menu_shell`
- `ds_modal_shell`
- `ds_bottom_sheet_shell`
- `ds_dialog_body`
- `ds_text_input`
- `ds_text_input_focus`
- `ds_text_input_error`
- `ds_select_field`
- `ds_textarea`
- `ds_checkbox`
- `ds_checkbox_checked`
- `ds_radio`
- `ds_radio_selected`
- `ds_switch`
- `ds_switch_on`
- `ds_segmented_control`
- `ds_section_card`
- `ds_list_row`
- `ds_table_row`
- `ds_stat_tile`
- `ds_action_chip`
- `ds_notice_banner`
- `ds_resource_tile`
- `ds_two_column_shell`
- `ds_split_pane_shell`
- `ds_settings_form_shell`
- `ds_badge`
- `ds_divider_horizontal`
- `ds_divider_vertical`
- `ds_avatar`
- `ds_empty_state`

This is no longer a token stub or starter set. It now covers:

- foundations and semantic tokens
- default, selected, focused, pressed, disabled, loading, and destructive states
- primitives and pills
- form controls
- app chrome and overlays
- content patterns
- layout templates
- Pencil-native reuse through reusable components, `ref`, `descendants`, and
  slots

## Variations

### Variation A

- Frame id:
  `variation-a_support-hub`
- Preview:
  `docs/specs/DEMO-PENCIL-001/variation-a.svg`
- Brief interpretation:
  turns the About page into a guided support hub with the clearest "go here
  next" emphasis
- Copy fidelity:
  draft
- Strengths:
  strongest single next-step guidance, easiest scan path, most balanced between
  support and community
- Failure modes or misses against the brief:
  still feels somewhat card-based and less editorial than the most distinctive
  option

### Variation B

- Frame id:
  `variation-b_command-center`
- Preview:
  `docs/specs/DEMO-PENCIL-001/variation-b.svg`
- Brief interpretation:
  emphasizes utility and status over concierge warmth
- Copy fidelity:
  draft
- Strengths:
  clearest information architecture, best for users who want to quickly inspect
  channels and status
- Failure modes or misses against the brief:
  feels more product-console-like and less human than the other two directions

### Variation C

- Frame id:
  `variation-c_concierge-split`
- Preview:
  `docs/specs/DEMO-PENCIL-001/variation-c.svg`
- Brief interpretation:
  pushes furthest toward the concierge and editorial tone in the design brief
- Copy fidelity:
  draft
- Strengths:
  most distinctive visual identity, strongest narrative tone
- Failure modes or misses against the brief:
  lowest information density on small screens and most likely to require extra
  responsive tuning

## Recommendation

Recommend Variation A for the first implementation pass.

Reason:

- it best balances the design brief's support-concierge direction with the
  existing utility needs of the About page
- it improves hierarchy without over-rotating into a dashboard or marketing
  page
- it should map cleanly onto the current Mantine and Tailwind token setup

## Approval

- Approved design brief:
  `docs/specs/DEMO-PENCIL-001/design-brief.md`
- Status:
  pending

Please respond with one of:

- approve Variation A
- approve Variation B
- approve Variation C
- revise with specific feedback

## Implementation Mode After Approval

Preferred mode: manual implementation against the approved `.pen` direction,
using Pencil only as the design source of truth.
