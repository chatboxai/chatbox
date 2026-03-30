# Slots

- Source: https://docs.pencil.dev/core-concepts/slots
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Slots

Slots are designated areas within a component where elements can be dropped in. They let you define flexible, customizable regions in your components.

## Create a Slot

1. Create a frame and turn it into a component — press Cmd/Ctrl + Option/Alt + K or click the “Create component” button at the top of the properties panel
2. Style it to your liking
3. Click the “Make a slot” button at the top of the properties panel

- Only empty frames in component origins can be turned into slots.
- Slots are marked with diagonal lines on the canvas, indicating the area where elements can be dropped.

### Suggested Slot Components

Other components in the same .pen file can be marked as “suggested slot components”.

For example, a table component’s slot can suggest table-row as the intended content. Suggested slot components give both human and AI designers guidance about what belongs in a given slot.

To mark a component as suggested:

1. Select the layer with a slot in the component origin
2. Click the + button on the “Slots” line at the top of the properties panel
3. Select the components you’d like to define as suggested

## Drop Elements into Slots

Once you have a component with a slot, you can populate it with elements.

1. Create a component instance
2. Drag and drop or copy and paste an element into the slot
