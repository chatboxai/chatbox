import {
  DRAWING_KIT_APP_ID,
  createInitialDrawingKitAppSnapshot,
  type DrawingKitAppSnapshot,
} from '@shared/chatbridge'
import type { ChatBridgeReviewedAppLaunch } from '../reviewed-app-launch'

function escapeInlineScriptValue(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function createGenericReviewedAppLaunchRuntimeMarkup(launch: ChatBridgeReviewedAppLaunch) {
  const serializedLaunch = escapeInlineScriptValue(launch)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${launch.appName} runtime</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background: linear-gradient(180deg, #f7f4ed 0%, #ffffff 100%);
        color: #1f2933;
      }

      body {
        display: grid;
        place-items: center;
        padding: 20px;
        box-sizing: border-box;
      }

      #reviewed-app-runtime-root {
        width: min(100%, 720px);
      }

      .runtime-card {
        border: 1px solid #d9c6a7;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 20px 45px rgba(77, 57, 28, 0.08);
        padding: 20px;
      }

      .runtime-eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 11px;
        color: #8a6b3d;
        margin-bottom: 10px;
      }

      .runtime-title {
        font-size: 24px;
        font-weight: 700;
        margin: 0 0 10px;
      }

      .runtime-summary {
        margin: 0 0 16px;
        color: #44505c;
        line-height: 1.5;
      }

      .runtime-meta {
        display: grid;
        gap: 10px;
      }

      .runtime-meta-row {
        border-radius: 12px;
        background: #f4eee3;
        padding: 10px 12px;
      }

      .runtime-meta-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #7c5b2d;
        margin-bottom: 4px;
      }

      .runtime-meta-value {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: #1f2933;
      }
    </style>
  </head>
  <body>
    <div id="reviewed-app-runtime-root"></div>
    <script>
      const launch = ${serializedLaunch};

      (() => {
        let bridgePort = null;
        let currentEnvelope = null;
        let nextSequence = 2;

        const root = document.getElementById('reviewed-app-runtime-root');

        function appendMeta(container, label, value) {
          if (!value) {
            return;
          }

          const row = document.createElement('div');
          row.className = 'runtime-meta-row';

          const labelEl = document.createElement('div');
          labelEl.className = 'runtime-meta-label';
          labelEl.textContent = label;

          const valueEl = document.createElement('p');
          valueEl.className = 'runtime-meta-value';
          valueEl.textContent = value;

          row.appendChild(labelEl);
          row.appendChild(valueEl);
          container.appendChild(row);
        }

        function renderSurface() {
          const card = document.createElement('article');
          card.className = 'runtime-card';

          const eyebrow = document.createElement('div');
          eyebrow.className = 'runtime-eyebrow';
          eyebrow.textContent = 'Reviewed app bridge launch';

          const title = document.createElement('h1');
          title.className = 'runtime-title';
          title.textContent = launch.appName + ' runtime';

          const summary = document.createElement('p');
          summary.className = 'runtime-summary';
          summary.textContent = launch.summary;

          const meta = document.createElement('div');
          meta.className = 'runtime-meta';

          appendMeta(meta, 'Request', launch.request);
          appendMeta(meta, 'Capability', launch.capability);
          appendMeta(meta, 'Initial FEN', launch.fen);
          appendMeta(meta, 'Initial PGN', launch.pgn);

          card.appendChild(eyebrow);
          card.appendChild(title);
          card.appendChild(summary);
          card.appendChild(meta);
          root.replaceChildren(card);
        }

        function sendState(kind, payload) {
          if (!bridgePort || !currentEnvelope) {
            return;
          }

          bridgePort.postMessage({
            kind,
            bridgeSessionId: currentEnvelope.bridgeSessionId,
            appInstanceId: currentEnvelope.appInstanceId,
            bridgeToken: currentEnvelope.bridgeToken,
            sequence: nextSequence++,
            ...payload,
          });
        }

        function sendInitialState() {
          sendState('app.state', {
            idempotencyKey: 'launch-ready-' + currentEnvelope.bridgeSessionId,
            snapshot: {
              kind: 'reviewed-app-launch',
              schemaVersion: 1,
              appId: launch.appId,
              appName: launch.appName,
              summary: launch.summary,
              statusText: 'Bridge active',
              request: launch.request || null,
              capability: launch.capability || null,
              fen: launch.fen || null,
              pgn: launch.pgn || null,
              uiEntry: launch.uiEntry || null,
              launchSurface: 'reviewed-app-bridge',
            },
          });
        }

        renderSurface();

        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || data.kind !== 'host.bootstrap' || bridgePort) {
            return;
          }
          if (!event.ports || event.ports.length === 0 || !data.envelope) {
            return;
          }

          currentEnvelope = data.envelope;
          if (currentEnvelope.expectedOrigin !== '*' && event.origin !== currentEnvelope.expectedOrigin) {
            return;
          }

          bridgePort = event.ports[0];
          bridgePort.start && bridgePort.start();

          bridgePort.postMessage({
            kind: 'app.ready',
            bridgeSessionId: currentEnvelope.bridgeSessionId,
            appInstanceId: currentEnvelope.appInstanceId,
            bridgeToken: currentEnvelope.bridgeToken,
            ackNonce: currentEnvelope.bootstrapNonce,
            sequence: 1,
          });

          queueMicrotask(sendInitialState);
        });

        window.addEventListener('error', (event) => {
          sendState('app.error', {
            idempotencyKey: 'window-error-' + nextSequence,
            error: event.message || 'reviewed app runtime error',
          });
        });

        window.addEventListener('unhandledrejection', (event) => {
          sendState('app.error', {
            idempotencyKey: 'unhandled-rejection-' + nextSequence,
            error: event.reason instanceof Error ? event.reason.message : String(event.reason),
          });
        });
      })();
    </script>
  </body>
</html>`
}

function createDrawingKitRuntimeMarkup(launch: ChatBridgeReviewedAppLaunch, initialSnapshot: DrawingKitAppSnapshot) {
  const serializedLaunch = escapeInlineScriptValue(launch)
  const serializedSnapshot = escapeInlineScriptValue(initialSnapshot)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${launch.appName} runtime</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif;
        --paper: #fffdf4;
        --paper-edge: #f1c56c;
        --paper-accent: #ff8a4c;
        --paper-soft: #fff1c7;
        --ink: #26211d;
        --muted: #6f6156;
        --blue: #267df0;
        --blue-soft: #eaf3ff;
      }

      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(255, 209, 102, 0.45), transparent 35%),
          linear-gradient(180deg, #fff7e5 0%, #fffdf7 100%);
        color: var(--ink);
      }

      body {
        padding: 18px;
        box-sizing: border-box;
      }

      button,
      input {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      button:focus-visible,
      input:focus-visible,
      canvas:focus-visible {
        outline: 3px solid rgba(38, 125, 240, 0.45);
        outline-offset: 2px;
      }

      #reviewed-app-runtime-root {
        width: min(100%, 960px);
        margin: 0 auto;
      }

      .doodle-shell {
        border: 1px solid var(--paper-edge);
        border-radius: 28px;
        background: rgba(255, 253, 244, 0.97);
        box-shadow: 0 24px 60px rgba(157, 113, 18, 0.12);
        padding: 18px;
      }

      .runtime-topbar,
      .runtime-toolbar,
      .runtime-meta-grid,
      .runtime-footer-grid,
      .runtime-canvas-actions {
        display: flex;
        gap: 12px;
      }

      .runtime-topbar,
      .runtime-toolbar {
        align-items: center;
        justify-content: space-between;
      }

      .runtime-topbar {
        gap: 16px;
        flex-wrap: wrap;
      }

      .runtime-title-block {
        min-width: 0;
        flex: 1 1 420px;
      }

      .runtime-eyebrow {
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 11px;
        color: #b87000;
        font-family: "IBM Plex Mono", monospace;
      }

      .runtime-title {
        margin: 0;
        font-family: "Avenir Next Condensed", "Avenir Next", "Trebuchet MS", sans-serif;
        font-size: clamp(28px, 5vw, 38px);
        line-height: 1.04;
      }

      .runtime-subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.45;
        max-width: 66ch;
      }

      .runtime-pill,
      .tool-chip,
      .stat-chip {
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
      }

      .runtime-pill {
        background: var(--paper-soft);
        border-color: #dfb04b;
        color: #7d5600;
      }

      .runtime-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .action-button {
        border-radius: 14px;
        border: 1px solid #dfb04b;
        background: #fff2c2;
        color: #4e3900;
        padding: 11px 16px;
        font-size: 13px;
        font-weight: 700;
      }

      .action-button--primary {
        border-color: #ff8a4c;
        background: #ff8a4c;
        color: white;
      }

      .runtime-toolbar {
        margin-top: 16px;
        padding: 10px 12px;
        border-radius: 20px;
        background: #ffe6a7;
        border: 1px solid var(--paper-edge);
        flex-wrap: wrap;
      }

      .runtime-tools {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .tool-chip {
        background: white;
        border-color: #d4e7ff;
        color: var(--blue);
      }

      .tool-chip[aria-pressed="true"] {
        background: var(--blue-soft);
        border-color: var(--blue);
      }

      .tool-chip--warm {
        border-color: #f3c17f;
        color: #915100;
        background: #fff6dd;
      }

      .runtime-meta-grid {
        margin-top: 18px;
        gap: 18px;
        align-items: stretch;
      }

      .runtime-canvas-card {
        min-width: 0;
        flex: 1 1 560px;
        border-radius: 28px;
        border: 1px solid var(--paper-edge);
        background: #fffdf4;
        padding: 16px;
      }

      .runtime-prompt-card {
        display: inline-flex;
        flex-direction: column;
        gap: 6px;
        border-radius: 20px;
        border: 2px solid var(--paper-accent);
        background: white;
        padding: 14px 16px;
        box-shadow: 0 12px 22px rgba(255, 138, 76, 0.14);
        margin-bottom: 12px;
      }

      .runtime-prompt-card strong {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--paper-accent);
      }

      .runtime-prompt-card span {
        font-size: 26px;
        font-weight: 800;
        line-height: 1.04;
      }

      .runtime-canvas-frame {
        position: relative;
        border-radius: 24px;
        border: 1px dashed #f0c36a;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 249, 232, 0.96)),
          repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(234, 198, 97, 0.12) 27px, rgba(234, 198, 97, 0.12) 28px);
        overflow: hidden;
      }

      canvas {
        display: block;
        width: 100%;
        height: 360px;
        cursor: crosshair;
        border: 0;
        background: transparent;
      }

      .runtime-canvas-actions {
        flex-wrap: wrap;
        align-items: end;
        margin-top: 12px;
      }

      .runtime-caption-field {
        flex: 1 1 260px;
      }

      .runtime-caption-field label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #915100;
        margin-bottom: 6px;
      }

      .runtime-caption-field input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 14px;
        border: 1px solid #edc676;
        padding: 12px 14px;
        background: white;
      }

      .runtime-footer-grid {
        margin-top: 18px;
        flex-wrap: wrap;
      }

      .runtime-support-card {
        min-width: 0;
        flex: 1 1 220px;
        border-radius: 24px;
        border: 1px solid #e8d7ad;
        background: white;
        padding: 18px;
      }

      .runtime-support-card--accent {
        background: #fff7de;
        border-color: var(--paper-edge);
      }

      .runtime-support-card--blue {
        background: #f4f9ff;
        border-color: #bed8ff;
      }

      .runtime-support-eyebrow {
        margin: 0 0 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 800;
      }

      .runtime-support-card h2 {
        margin: 0;
        font-size: 28px;
        line-height: 1.02;
      }

      .runtime-support-card p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.45;
      }

      .runtime-summary-inline {
        margin-top: 12px;
        font-size: 13px;
        color: #7b5b1d;
        background: rgba(255, 247, 222, 0.92);
        border-radius: 14px;
        padding: 10px 12px;
      }

      .runtime-keyboard-note {
        margin-top: 10px;
        font-size: 12px;
        color: var(--muted);
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (max-width: 820px) {
        body {
          padding: 10px;
        }

        .doodle-shell {
          padding: 14px;
        }

        canvas {
          height: 300px;
        }
      }
    </style>
  </head>
  <body>
    <div id="reviewed-app-runtime-root"></div>
    <script>
      const launch = ${serializedLaunch};
      const initialSnapshot = ${serializedSnapshot};

      (() => {
        let bridgePort = null;
        let currentEnvelope = null;
        let nextSequence = 2;
        const root = document.getElementById('reviewed-app-runtime-root');
        const state = {
          snapshot: JSON.parse(JSON.stringify(initialSnapshot)),
          marks: Array.isArray(initialSnapshot.previewMarks) ? JSON.parse(JSON.stringify(initialSnapshot.previewMarks)) : [],
          bankedSnapshot: JSON.parse(JSON.stringify(initialSnapshot)),
          pointerStroke: null,
        };

        function clone(value) {
          return JSON.parse(JSON.stringify(value));
        }

        function pluralize(count, singular, plural) {
          return count === 1 ? singular : plural || singular + 's';
        }

        function clamp(value) {
          if (!Number.isFinite(value)) {
            return 0;
          }
          return Math.min(1, Math.max(0, value));
        }

        function samplePoints(points) {
          if (points.length <= 12) {
            return points.map((point) => ({ x: clamp(point.x), y: clamp(point.y) }));
          }

          const sampled = [];
          for (let index = 0; index < 12; index += 1) {
            const sourceIndex = Math.round((index / 11) * (points.length - 1));
            const point = points[sourceIndex] || points[points.length - 1];
            sampled.push({
              x: clamp(point.x),
              y: clamp(point.y),
            });
          }
          return sampled;
        }

        function normalizeMarks(marks) {
          return marks.slice(-24).map((mark) => {
            if (mark.kind === 'line') {
              return {
                kind: 'line',
                tool: mark.tool,
                color: mark.color,
                width: mark.width,
                points: samplePoints(mark.points || []),
              };
            }

            return {
              kind: 'stamp',
              stamp: mark.stamp,
              color: mark.color,
              size: mark.size,
              x: clamp(mark.x),
              y: clamp(mark.y),
            };
          });
        }

        function buildCheckpointSummary(snapshot) {
          const captionSegment = snapshot.caption ? '"' + snapshot.caption + '"' : 'Uncaptioned doodle';
          const stickerSegment = snapshot.stickerCount > 0
            ? snapshot.stickerCount + ' ' + pluralize(snapshot.stickerCount, 'sticker') + ' (' + snapshot.rewardLabel + ')'
            : 'no stickers banked yet';

          return captionSegment + '; ' + snapshot.strokeCount + ' ' + pluralize(snapshot.strokeCount, 'stroke') + '; ' + stickerSegment + '.';
        }

        function buildStatusText(status, stickerCount) {
          if (status === 'complete') {
            return 'Round locked';
          }
          if (status === 'checkpointed') {
            return stickerCount > 0 ? stickerCount + ' ' + pluralize(stickerCount, 'sticker') + ' banked' : 'Checkpoint banked';
          }
          if (status === 'drawing') {
            return 'Round in progress';
          }
          return 'Ready for doodle dare';
        }

        function buildSummary(snapshot) {
          const captionSegment = snapshot.caption
            ? 'The doodle is labeled "' + snapshot.caption + '".'
            : 'The doodle is still uncaptured by caption.';
          const rewardSegment = snapshot.stickerCount > 0
            ? snapshot.stickerCount + ' ' + pluralize(snapshot.stickerCount, 'sticker') + ' are banked as ' + snapshot.rewardLabel + '.'
            : 'No sticker reward is banked yet.';

          if (snapshot.status === 'blank') {
            return 'Drawing Kit is ready with the prompt "' + snapshot.roundPrompt + '". The host keeps a blank canvas checkpoint visible before any marks are made.';
          }

          if (snapshot.status === 'complete') {
            return 'Drawing Kit round complete. Prompt "' + snapshot.roundPrompt + '". ' + captionSegment + ' ' + snapshot.strokeCount + ' ' + pluralize(snapshot.strokeCount, 'stroke') + ' were captured with ' + snapshot.selectedTool + '. ' + rewardSegment + ' Later chat can recap or replay the saved round without raw stroke history.';
          }

          if (snapshot.status === 'checkpointed') {
            return 'Drawing Kit checkpoint banked. Prompt "' + snapshot.roundPrompt + '". ' + captionSegment + ' ' + snapshot.strokeCount + ' ' + pluralize(snapshot.strokeCount, 'stroke') + ' were saved with ' + snapshot.selectedTool + '. ' + rewardSegment + ' Later chat can use the checkpoint instead of raw stroke history.';
          }

          return 'Drawing Kit round in progress. Prompt "' + snapshot.roundPrompt + '". ' + captionSegment + ' ' + snapshot.strokeCount + ' ' + pluralize(snapshot.strokeCount, 'stroke') + ' are visible with ' + snapshot.selectedTool + '. ' + rewardSegment;
        }

        function createSnapshot(status) {
          const captionInput = document.getElementById('caption-input');
          const caption = captionInput && captionInput.value.trim() ? captionInput.value.trim() : undefined;
          const nextSnapshot = {
            ...state.snapshot,
            status,
            caption,
            selectedTool: state.snapshot.selectedTool,
            strokeCount: state.marks.length,
            stickerCount: state.marks.filter((mark) => mark.kind === 'stamp').length,
            checkpointId: 'drawing-kit-' + Date.now(),
            previewMarks: normalizeMarks(state.marks),
            lastUpdatedAt: Date.now(),
          };

          nextSnapshot.statusText = buildStatusText(nextSnapshot.status, nextSnapshot.stickerCount);
          nextSnapshot.summary = buildSummary(nextSnapshot);
          nextSnapshot.checkpointSummary = buildCheckpointSummary(nextSnapshot);
          nextSnapshot.resumeHint =
            nextSnapshot.status === 'complete'
              ? 'Play again reopens ' + nextSnapshot.roundLabel + ' from checkpoint ' + nextSnapshot.checkpointId + '.'
              : 'Replay round reopens ' + nextSnapshot.roundLabel + ' from checkpoint ' + nextSnapshot.checkpointId + '.';

          return nextSnapshot;
        }

        function sendBridgeEvent(kind, payload) {
          if (!bridgePort || !currentEnvelope) {
            return;
          }

          bridgePort.postMessage({
            kind,
            bridgeSessionId: currentEnvelope.bridgeSessionId,
            appInstanceId: currentEnvelope.appInstanceId,
            bridgeToken: currentEnvelope.bridgeToken,
            sequence: nextSequence++,
            ...payload,
          });
        }

        function publishSnapshot(status, reason) {
          const nextSnapshot = createSnapshot(status);
          state.snapshot = clone(nextSnapshot);
          if (status === 'checkpointed' || status === 'complete' || status === 'blank') {
            state.bankedSnapshot = clone(nextSnapshot);
          }

          sendBridgeEvent('app.state', {
            idempotencyKey: reason + '-' + nextSnapshot.checkpointId,
            snapshot: nextSnapshot,
          });

          render();
          return nextSnapshot;
        }

        function publishCompletion() {
          const nextSnapshot = publishSnapshot('complete', 'complete');
          sendBridgeEvent('app.complete', {
            idempotencyKey: 'complete-' + nextSnapshot.checkpointId,
            completion: {
              schemaVersion: 1,
              status: 'success',
              suggestedSummary: {
                title: 'Drawing Kit round returned to chat',
                text: nextSnapshot.summary,
                bullets: [
                  'Prompt: ' + nextSnapshot.roundPrompt,
                  'Caption: ' + (nextSnapshot.caption || 'Uncaptioned doodle'),
                  nextSnapshot.stickerCount + ' ' + pluralize(nextSnapshot.stickerCount, 'sticker') + ' banked',
                ],
              },
              outcomeData: {
                appId: launch.appId,
                roundLabel: nextSnapshot.roundLabel,
                checkpointId: nextSnapshot.checkpointId,
                caption: nextSnapshot.caption || null,
                rewardLabel: nextSnapshot.rewardLabel,
              },
              resumability: {
                resumable: true,
                checkpointId: nextSnapshot.checkpointId,
                resumeHint: nextSnapshot.resumeHint,
              },
            },
          });
        }

        function sendProgressCheckpoint(reason) {
          const nextSnapshot = createSnapshot('drawing');
          state.snapshot = clone(nextSnapshot);

          sendBridgeEvent('app.state', {
            idempotencyKey: reason + '-' + nextSnapshot.strokeCount + '-' + nextSnapshot.lastUpdatedAt,
            snapshot: nextSnapshot,
          });

          render();
        }

        function drawLine(ctx, mark, width, height) {
          if (!mark.points || mark.points.length < 2) {
            return;
          }

          if (mark.tool === 'spray') {
            ctx.fillStyle = mark.color;
            mark.points.forEach((point, pointIndex) => {
              const x = point.x * width;
              const y = point.y * height;
              for (let sprayIndex = 0; sprayIndex < 6; sprayIndex += 1) {
                const radius = 6 + sprayIndex * 1.5;
                const angle = pointIndex * 0.9 + sprayIndex;
                ctx.beginPath();
                ctx.arc(
                  x + Math.cos(angle) * radius,
                  y + Math.sin(angle) * radius,
                  1.2,
                  0,
                  Math.PI * 2
                );
                ctx.fill();
              }
            });
            return;
          }

          ctx.strokeStyle = mark.color;
          ctx.lineWidth = mark.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          mark.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          });
          ctx.stroke();
        }

        function drawStamp(ctx, mark, width, height) {
          const x = mark.x * width;
          const y = mark.y * height;
          const radius = mark.size;
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = mark.color;
          ctx.beginPath();
          if (mark.stamp === 'burst') {
            for (let index = 0; index < 12; index += 1) {
              const outer = index % 2 === 0 ? radius : radius * 0.45;
              const angle = (Math.PI / 6) * index;
              const px = Math.cos(angle) * outer;
              const py = Math.sin(angle) * outer;
              if (index === 0) {
                ctx.moveTo(px, py);
              } else {
                ctx.lineTo(px, py);
              }
            }
            ctx.closePath();
          } else {
            for (let index = 0; index < 5; index += 1) {
              const outerAngle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
              const innerAngle = outerAngle + Math.PI / 5;
              const outerX = Math.cos(outerAngle) * radius;
              const outerY = Math.sin(outerAngle) * radius;
              const innerX = Math.cos(innerAngle) * radius * 0.45;
              const innerY = Math.sin(innerAngle) * radius * 0.45;
              if (index === 0) {
                ctx.moveTo(outerX, outerY);
              } else {
                ctx.lineTo(outerX, outerY);
              }
              ctx.lineTo(innerX, innerY);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.restore();
        }

        function renderCanvas() {
          const canvas = document.getElementById('drawing-canvas');
          if (!canvas) {
            return;
          }

          const frame = canvas.parentElement;
          const width = Math.max(320, frame ? Math.floor(frame.clientWidth) : 720);
          const height = 360;
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return;
          }

          ctx.clearRect(0, 0, width, height);

          state.marks.forEach((mark) => {
            if (mark.kind === 'line') {
              drawLine(ctx, mark, width, height);
            } else {
              drawStamp(ctx, mark, width, height);
            }
          });

          if (state.pointerStroke) {
            drawLine(ctx, state.pointerStroke, width, height);
          }
        }

        function pushMark(mark, reason) {
          state.marks = normalizeMarks(state.marks.concat(mark));
          if (state.marks.length === 1 || state.marks.length % 4 === 0 || reason === 'stamp') {
            sendProgressCheckpoint(reason);
          } else {
            render();
          }
        }

        function getCanvasPoint(event, canvas) {
          const rect = canvas.getBoundingClientRect();
          return {
            x: clamp((event.clientX - rect.left) / rect.width),
            y: clamp((event.clientY - rect.top) / rect.height),
          };
        }

        function createSyntheticLine(tool) {
          const seed = state.marks.length + 1;
          const points = [
            { x: 0.16 + (seed % 3) * 0.08, y: 0.24 + (seed % 4) * 0.08 },
            { x: 0.3 + (seed % 2) * 0.06, y: 0.36 + (seed % 5) * 0.05 },
            { x: 0.48 + (seed % 3) * 0.04, y: 0.28 + (seed % 2) * 0.1 },
            { x: 0.7, y: 0.45 + (seed % 4) * 0.05 },
          ];
          return {
            kind: 'line',
            tool,
            color: tool === 'spray' ? '#ff8a4c' : '#267df0',
            width: tool === 'spray' ? 3 : 5,
            points,
          };
        }

        function createSyntheticStamp() {
          const seed = state.marks.length + 1;
          const stampKinds = ['star', 'spark', 'burst'];
          return {
            kind: 'stamp',
            stamp: stampKinds[seed % stampKinds.length],
            color: '#f2b61b',
            size: 16,
            x: 0.2 + (seed % 6) * 0.11,
            y: 0.24 + (seed % 4) * 0.15,
          };
        }

        function updateSelectedTool(nextTool) {
          state.snapshot.selectedTool = nextTool;
          render();
        }

        function undoMark() {
          state.marks = state.marks.slice(0, -1);
          sendProgressCheckpoint('undo');
        }

        function replayRound() {
          const baseSnapshot = clone(state.bankedSnapshot);
          state.snapshot = {
            ...baseSnapshot,
            status: baseSnapshot.status === 'complete' ? 'checkpointed' : baseSnapshot.status,
            statusText: baseSnapshot.status === 'complete' ? 'Checkpoint banked' : baseSnapshot.statusText,
          };
          state.marks = clone(baseSnapshot.previewMarks || []);

          const captionInput = document.getElementById('caption-input');
          if (captionInput) {
            captionInput.value = baseSnapshot.caption || '';
          }

          sendBridgeEvent('app.state', {
            idempotencyKey: 'replay-' + state.snapshot.checkpointId,
            snapshot: state.snapshot,
          });
          render();
        }

        function bindCanvas() {
          const canvas = document.getElementById('drawing-canvas');
          if (!canvas) {
            return;
          }

          canvas.addEventListener('pointerdown', (event) => {
            if (state.snapshot.selectedTool === 'stamp') {
              pushMark(
                {
                  kind: 'stamp',
                  stamp: 'star',
                  color: '#f2b61b',
                  size: 16,
                  ...getCanvasPoint(event, canvas),
                },
                'stamp'
              );
              return;
            }

            state.pointerStroke = {
              kind: 'line',
              tool: state.snapshot.selectedTool,
              color: state.snapshot.selectedTool === 'spray' ? '#ff8a4c' : '#267df0',
              width: state.snapshot.selectedTool === 'spray' ? 3 : 5,
              points: [getCanvasPoint(event, canvas)],
            };
            canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
            renderCanvas();
          });

          canvas.addEventListener('pointermove', (event) => {
            if (!state.pointerStroke) {
              return;
            }

            state.pointerStroke.points.push(getCanvasPoint(event, canvas));
            renderCanvas();
          });

          function finishPointerStroke() {
            if (!state.pointerStroke) {
              return;
            }

            if (state.pointerStroke.points.length > 1) {
              pushMark(
                {
                  ...state.pointerStroke,
                  points: samplePoints(state.pointerStroke.points),
                },
                'stroke'
              );
            }
            state.pointerStroke = null;
            renderCanvas();
          }

          canvas.addEventListener('pointerup', finishPointerStroke);
          canvas.addEventListener('pointercancel', finishPointerStroke);
          canvas.addEventListener('keydown', (event) => {
            if (event.key.toLowerCase() === 'b') {
              updateSelectedTool('brush');
            }
            if (event.key.toLowerCase() === 's') {
              updateSelectedTool('spray');
            }
            if (event.key.toLowerCase() === 't') {
              updateSelectedTool('stamp');
            }
            if (event.key.toLowerCase() === 'u') {
              undoMark();
            }
          });
        }

        function bindControls() {
          root.querySelectorAll('[data-tool]').forEach((button) => {
            button.addEventListener('click', () => updateSelectedTool(button.getAttribute('data-tool')));
          });

          const undoButton = document.getElementById('undo-button');
          undoButton && undoButton.addEventListener('click', undoMark);

          const squiggleButton = document.getElementById('squiggle-button');
          squiggleButton &&
            squiggleButton.addEventListener('click', () => {
              pushMark(createSyntheticLine(state.snapshot.selectedTool === 'stamp' ? 'brush' : state.snapshot.selectedTool), 'keyboard-squiggle');
            });

          const stickerButton = document.getElementById('sticker-button');
          stickerButton &&
            stickerButton.addEventListener('click', () => {
              pushMark(createSyntheticStamp(), 'stamp');
            });

          const checkpointButton = document.getElementById('checkpoint-button');
          checkpointButton && checkpointButton.addEventListener('click', () => publishSnapshot('checkpointed', 'checkpoint'));

          const replayButton = document.getElementById('replay-button');
          replayButton && replayButton.addEventListener('click', replayRound);

          const lockButton = document.getElementById('lock-button');
          lockButton && lockButton.addEventListener('click', publishCompletion);
        }

        function render() {
          const snapshot = state.snapshot;
          root.innerHTML = \`
            <article class="doodle-shell" data-drawing-kit-runtime="true">
              <div class="runtime-topbar">
                <div class="runtime-title-block">
                  <p class="runtime-eyebrow">\${snapshot.roundLabel.toUpperCase()} · STICKER SPRINT</p>
                  <h1 class="runtime-title">Drawing Kit should feel like a sticky-note doodle dare</h1>
                  <p class="runtime-subtitle">One weird prompt, four chunky tools, a sticker jackpot, and a clean host checkpoint if the round gets handed back to chat.</p>
                </div>
                <div class="runtime-actions">
                  <button id="replay-button" class="action-button" type="button">Replay round</button>
                  <button id="lock-button" class="action-button action-button--primary" type="button">Lock this round</button>
                </div>
              </div>

              <div class="runtime-toolbar">
                <div class="runtime-tools" role="toolbar" aria-label="Drawing Kit tools">
                  <button class="tool-chip" data-tool="brush" aria-pressed="\${snapshot.selectedTool === 'brush'}" type="button">Brush</button>
                  <button class="tool-chip" data-tool="spray" aria-pressed="\${snapshot.selectedTool === 'spray'}" type="button">Spray</button>
                  <button class="tool-chip" data-tool="stamp" aria-pressed="\${snapshot.selectedTool === 'stamp'}" type="button">Stamp</button>
                  <button id="undo-button" class="tool-chip tool-chip--warm" type="button">Undo</button>
                  <button id="squiggle-button" class="tool-chip tool-chip--warm" type="button">Add squiggle</button>
                  <button id="sticker-button" class="tool-chip tool-chip--warm" type="button">Drop sticker</button>
                </div>
                <span class="runtime-pill">\${snapshot.statusText}</span>
              </div>

              <div class="runtime-meta-grid">
                <section class="runtime-canvas-card">
                  <div class="runtime-prompt-card">
                    <strong>\${snapshot.roundLabel}</strong>
                    <span>\${snapshot.roundPrompt}</span>
                  </div>
                  <div class="runtime-canvas-frame">
                    <canvas id="drawing-canvas" tabindex="0" aria-label="Drawing Kit doodle canvas"></canvas>
                  </div>
                  <div class="runtime-canvas-actions">
                    <div class="runtime-caption-field">
                      <label for="caption-input">Tell chat what you drew</label>
                      <input
                        id="caption-input"
                        type="text"
                        maxlength="80"
                        value="\${snapshot.caption ? snapshot.caption.replace(/"/g, '&quot;') : ''}"
                        placeholder="Example: triple pickle sandwich"
                      />
                    </div>
                    <button id="checkpoint-button" class="action-button" type="button">Bank this round</button>
                  </div>
                  <p class="runtime-keyboard-note">Keyboard path: use the buttons above or press B, S, T, and U while the canvas is focused.</p>
                </section>

                <section class="runtime-footer-grid" style="flex: 0 0 290px; flex-direction: column; min-width: 290px;">
                  <article class="runtime-support-card runtime-support-card--blue">
                    <p class="runtime-support-eyebrow" style="color:#267df0;">Round bank</p>
                    <h2>Bank this round</h2>
                    <p>The host keeps the prompt, doodle label, and sticker win without storing raw stroke history.</p>
                    <div class="runtime-summary-inline">\${snapshot.checkpointSummary}</div>
                  </article>
                  <article class="runtime-support-card runtime-support-card--accent">
                    <p class="runtime-support-eyebrow" style="color:#ff8a4c;">Chat handoff</p>
                    <h2>Tell chat what you drew</h2>
                    <p>\${snapshot.summary}</p>
                  </article>
                </section>
              </div>
            </article>
            <p id="runtime-status-live" class="sr-only" aria-live="polite">\${snapshot.statusText}</p>
          \`;

          const captionInput = document.getElementById('caption-input');
          if (captionInput) {
            captionInput.value = snapshot.caption || '';
          }
          bindControls();
          bindCanvas();
          renderCanvas();
        }

        function sendInitialState() {
          sendBridgeEvent('app.state', {
            idempotencyKey: 'drawing-kit-ready-' + currentEnvelope.bridgeSessionId,
            snapshot: state.snapshot,
          });
        }

        render();

        window.addEventListener('resize', renderCanvas);

        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || data.kind !== 'host.bootstrap' || bridgePort) {
            return;
          }
          if (!event.ports || event.ports.length === 0 || !data.envelope) {
            return;
          }

          currentEnvelope = data.envelope;
          if (currentEnvelope.expectedOrigin !== '*' && event.origin !== currentEnvelope.expectedOrigin) {
            return;
          }

          bridgePort = event.ports[0];
          bridgePort.start && bridgePort.start();

          bridgePort.postMessage({
            kind: 'app.ready',
            bridgeSessionId: currentEnvelope.bridgeSessionId,
            appInstanceId: currentEnvelope.appInstanceId,
            bridgeToken: currentEnvelope.bridgeToken,
            ackNonce: currentEnvelope.bootstrapNonce,
            sequence: 1,
          });

          queueMicrotask(sendInitialState);
        });

        window.addEventListener('error', (event) => {
          sendBridgeEvent('app.error', {
            idempotencyKey: 'window-error-' + nextSequence,
            error: event.message || 'drawing kit runtime error',
          });
        });

        window.addEventListener('unhandledrejection', (event) => {
          sendBridgeEvent('app.error', {
            idempotencyKey: 'unhandled-rejection-' + nextSequence,
            error: event.reason instanceof Error ? event.reason.message : String(event.reason),
          });
        });
      })();
    </script>
  </body>
</html>`
}

export function createReviewedAppLaunchRuntimeMarkup(
  launch: ChatBridgeReviewedAppLaunch,
  persistedSnapshot?: unknown
) {
  if (launch.appId === DRAWING_KIT_APP_ID) {
    return createDrawingKitRuntimeMarkup(
      launch,
      createInitialDrawingKitAppSnapshot({
        request: launch.request,
        snapshot: persistedSnapshot,
      })
    )
  }

  return createGenericReviewedAppLaunchRuntimeMarkup(launch)
}
