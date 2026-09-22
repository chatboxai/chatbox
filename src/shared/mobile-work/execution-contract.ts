export const QUICKJS_ENVIRONMENT = `code_execution runs JavaScript in a QuickJS sandbox. Available APIs are standard ECMAScript built-ins, console.log/info/warn/error, and the async files and docs helpers. Inside code_execution, Node.js, npm packages, shell, Python, network and browser APIs are unavailable. The executed script must not use require, import/export, process, Buffer, module, exports, __dirname, __filename, fetch, window or document. These sandbox restrictions apply to the executed script, not to browser JavaScript written into generated website files. Await every files and docs call. Submit an async function body directly: top-level await works; no entrypoint or wrapper is needed. Each call starts with fresh variables; file changes persist only after successful execution. Execution has a 20 second deadline.`

export const QUICKJS_FILES = `All files methods return promises: await files.readText(path), files.writeText(path, text), files.readBase64(path), files.writeBase64(path, base64), and files.list(). Use workspace-relative paths; input/ and artifacts/ are read-only. Write outputs under output/. Use console.log for short results.`

export const QUICKJS_EXAMPLE = `Example:
const data = JSON.parse(await files.readText('input/data.json'));
await files.writeText('output/result.json', JSON.stringify(data));
console.log('Saved output/result.json');`

export const QUICKJS_CODE_INPUT =
  'JavaScript async function body for QuickJS. Use await files.readText/writeText for file I/O. No require, import/export, process, Buffer, Node.js packages or browser APIs.'

export function explainQuickJSError(error: string | undefined): string | undefined {
  if (!error) return error
  const missing =
    /^(?:ReferenceError: )?['"]?(require|process|Buffer|__dirname|__filename|module|exports|fetch|window|document)['"]? is not defined$/.exec(
      error
    )
  if (!missing) return error
  const name = missing[1]
  const hint =
    name === 'Buffer'
      ? 'For binary files, use await files.readBase64(path) and await files.writeBase64(path, base64).'
      : name === 'fetch'
        ? 'Use web tools for network access if available; otherwise explain that network access is unavailable.'
        : name === 'window' || name === 'document'
          ? 'Write HTML with await files.writeText(path, html), then deliver it with create_download for preview.'
          : 'For file I/O, use await files.readText(path) and await files.writeText(path, text). Use workspace-relative paths. For document helpers, load the relevant documents, spreadsheets or presentations skill.'
  return `${error}\nQuickJS runtime: ${name} is unavailable. ${hint} Rewrite the code using the supported APIs; execution files were not saved.`
}
