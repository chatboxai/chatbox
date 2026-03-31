const ARTIFACT_RUNTIME_SCRIPT = String.raw`
(() => {
  let bridgePort = null;
  let currentEnvelope = null;
  let nextSequence = 2;

  const root = document.getElementById('artifact-runtime-root');
  const runtimeFrame = document.createElement('iframe');
  runtimeFrame.setAttribute('sandbox', 'allow-scripts allow-forms');
  runtimeFrame.setAttribute('title', 'Artifact preview runtime');
  runtimeFrame.style.width = '100%';
  runtimeFrame.style.height = '100%';
  runtimeFrame.style.border = '0';
  runtimeFrame.style.background = 'white';
  runtimeFrame.style.display = 'block';
  root.appendChild(runtimeFrame);

  function sendStateful(kind, payload) {
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

  function renderHtml(message) {
    runtimeFrame.srcdoc = message.html;
    sendStateful('app.state', {
      idempotencyKey: message.renderId,
      snapshot: {
        renderId: message.renderId,
        rendered: true,
      },
    });
  }

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
    bridgePort.start?.();
    bridgePort.onmessage = (bridgeEvent) => {
      const message = bridgeEvent.data;
      if (!message || message.kind !== 'host.render') {
        return;
      }

      try {
        renderHtml(message);
      } catch (error) {
        sendStateful('app.error', {
          idempotencyKey: message.renderId + ':error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    bridgePort.postMessage({
      kind: 'app.ready',
      bridgeSessionId: currentEnvelope.bridgeSessionId,
      appInstanceId: currentEnvelope.appInstanceId,
      bridgeToken: currentEnvelope.bridgeToken,
      ackNonce: currentEnvelope.bootstrapNonce,
      sequence: 1,
    });
  });

  window.addEventListener('error', (event) => {
    if (!currentEnvelope) {
      return;
    }

    sendStateful('app.error', {
      idempotencyKey: 'window-error-' + nextSequence,
      error: event.message || 'artifact runtime error',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!currentEnvelope) {
      return;
    }

    sendStateful('app.error', {
      idempotencyKey: 'unhandled-rejection-' + nextSequence,
      error: event.reason instanceof Error ? event.reason.message : String(event.reason),
    });
  });
})();
`

export function createArtifactPreviewRuntimeMarkup() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #artifact-runtime-root {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div id="artifact-runtime-root"></div>
    <script>${ARTIFACT_RUNTIME_SCRIPT}</script>
  </body>
</html>`
}
