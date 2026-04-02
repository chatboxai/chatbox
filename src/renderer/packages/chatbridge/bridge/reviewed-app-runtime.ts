import type { ChatBridgeReviewedAppLaunch } from '../reviewed-app-launch'

function escapeInlineScriptValue(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function createReviewedAppLaunchRuntimeMarkup(launch: ChatBridgeReviewedAppLaunch) {
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
