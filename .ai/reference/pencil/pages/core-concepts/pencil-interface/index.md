# Pencil Interface

- Source: https://docs.pencil.dev/core-concepts/pencil-interface
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Pencil Interface

## Infinite Canvas

The canvas gives you an unlimited workspace to freely explore and develop your designs. It builds on principles you already know from professional design tools, so it should feel familiar right away.

To move around, hold spacebar and drag . To zoom in or out, use your trackpad or hold Cmd/Ctrl and scroll.

### Navigation Shortcuts

Keyboard shortcuts can save you a lot of time. You can find the full list here , or open it anytime in the app by clicking the keyboard icon in the toolbar.

- Spacebar + Drag - Pan canvas
- Shift + Scroll - Horizontal pan
- 0 - Zoom to 100%
- 1 - Zoom to fit all elements

## Frames

Frames are containers for your designs.

- Group related elements
- Define screen boundaries
- Cmd/Ctrl + Option/Alt + G - Apply flex layout to a selection

### Selection & Highlighting

Click and drag to select elements on the canvas. Selected elements are highlighted with colored bounding boxes that indicate their type.

Blue bounding boxes appear around regular elements like frames, shapes, and text.

Magenta and violet bounding boxes appear around components — reusable elements.

- Magenta marks the component origin, which serves as the source of truth. Any changes you make here are applied across all instances automatically.
- Violet marks instances of components.

### Selection Shortcuts

- Click - Select element
- Cmd/Ctrl + Click - Direct select (deepest element)
- Shift + Click - Add to selection
- Cmd/Ctrl + A - Select all

## Layers Panel

The layers panel sits on the left side of the screen and lists every element on the canvas. It gives you a clear view of your design hierarchy, making it easy to browse, edit, and organize elements in complex nested structures.

- Rename a layer by double-clicking it in the panel.
- Click the “Layers” icon to toggle the panel.

## Properties Panel

The properties panel appears on the right side of the screen when you select one or more elements on the canvas. It lets you view and edit properties like alignment, layout, appearance, fill, stroke, effects, and more.

- Export selections as PNG, JPEG, WEBP, and PDF.
- Click the icon in the top right corner to minimize it.

## AI Chat

Pencil’s AI chat is the interface for vibe-designing. You can ask it to design something from scratch or edit existing designs on the canvas.

The chat panel is built into the desktop app. When using the Pencil extension in your IDE, use your IDE’s built-in chat to work with the AI agent instead.

- Any selections you make on the canvas are automatically added to the context.
- Click “New chat” to start fresh and clear the context window.

## Undo / Redo

- Use Cmd + Z (Ctrl + Z) to undo changes
- Use Cmd + Shift + Z (Ctrl + Shift + Z) to redo changes
- Undo and Redo may be more limited than in standard design editors

Best Practices:

- Save frequently and use Git commits before major changes
- Save often (Cmd/Ctrl + S)
- Use Git history to revert if needed
