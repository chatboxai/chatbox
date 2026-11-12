import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  BUILT_IN_BROWSER_MAX_UPLOAD_FILE_BYTES,
  BUILT_IN_BROWSER_MAX_UPLOAD_FILES,
  type BuiltInBrowserUploadErrorCode,
  type BuiltInBrowserUploadFile,
} from '@shared/built-in-browser'
import type { PageDebugger } from './page-debugger'
import { PAGE_REFS_SOURCE, SNAPSHOT_REF_PATTERN } from './page-snapshot'

type Cdp = Pick<PageDebugger, 'send' | 'nextEvent' | 'reset'>

/** How long a click on the target may take to open a file picker. */
const FILE_CHOOSER_TIMEOUT_MS = 3_000
/** How long restoring the page after an upload may take before its debugger session is ended instead. */
const RESTORE_TIMEOUT_MS = 2_000
const OBJECT_GROUP = 'chatbox-upload'

type Refusal = {
  code: BuiltInBrowserUploadErrorCode
  message: string
  files?: BuiltInBrowserUploadFile[]
  approvalVersion?: string
}

function isInside(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Checks the files an upload hands to a page and resolves them to canonical paths, which the page
 * receives. Containment in `allowedRoots` is decided on those paths, so a symlink inside an allowed
 * directory cannot hand over a file outside it. Files outside need an approval whose
 * `approvedVersion` names these files as they are now: the same canonical paths, sizes and
 * modification times.
 */
export async function inspectUploadFiles(request: {
  files: string[]
  baseDirectory?: string
  allowedRoots?: string[]
  approvedVersion?: string
}): Promise<{ files: BuiltInBrowserUploadFile[] } | Refusal> {
  const { files: requested, baseDirectory, allowedRoots, approvedVersion } = request
  if (requested.length === 0) return { code: 'file_unavailable', message: 'No files to upload.' }
  if (requested.length > BUILT_IN_BROWSER_MAX_UPLOAD_FILES) {
    return {
      code: 'file_unavailable',
      message: `At most ${BUILT_IN_BROWSER_MAX_UPLOAD_FILES} files can be uploaded at once.`,
    }
  }
  const files: BuiltInBrowserUploadFile[] = []
  const identity = createHash('sha256')
  for (const requestedPath of requested) {
    if (!path.isAbsolute(requestedPath) && !baseDirectory) {
      return { code: 'file_unavailable', message: `Use an absolute path: ${requestedPath}` }
    }
    let realPath: string
    let size: number
    try {
      realPath = await realpath(path.resolve(baseDirectory ?? '', requestedPath))
      const info = await stat(realPath)
      if (!info.isFile()) return { code: 'file_unavailable', message: `Not a file: ${requestedPath}` }
      size = info.size
      identity.update(JSON.stringify([realPath, info.dev, info.ino, size, info.mtimeMs]))
    } catch {
      return { code: 'file_unavailable', message: `File not found: ${requestedPath}` }
    }
    if (size > BUILT_IN_BROWSER_MAX_UPLOAD_FILE_BYTES) {
      return {
        code: 'file_unavailable',
        message: `${requestedPath} is larger than ${BUILT_IN_BROWSER_MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB.`,
      }
    }
    files.push({ name: path.basename(realPath), size, path: realPath })
  }
  if (allowedRoots) {
    // A file system root would contain every file, so it never exempts an upload from approval.
    const roots = (await Promise.all(allowedRoots.map((root) => realpath(root).catch(() => null)))).filter(
      (root): root is string => root !== null && path.parse(root).root !== root
    )
    const approvalVersion = identity.digest('hex')
    if (approvedVersion !== approvalVersion && files.some((file) => !roots.some((root) => isInside(root, file.path)))) {
      return {
        code: 'approval_required',
        message: 'Some files are outside the working directories; the user has to approve this upload.',
        files,
        approvalVersion,
      }
    }
  }
  return { files }
}

export type HandFilesOutcome =
  | { kind: 'handed' }
  /** The page was not touched. */
  | { kind: 'refused'; code: BuiltInBrowserUploadErrorCode; message: string }
  /** The target was clicked but the files were not handed over. */
  | { kind: 'failed'; code: BuiltInBrowserUploadErrorCode; message: string }

// Called on the target: the file input it is, the one a label controls, or the only one inside it.
// Targets from a same-origin frame belong to that frame's realm, so elements are told apart by tag.
const FIND_FILE_INPUT = `function () {
  const isFileInput = (element) => !!element && element.localName === 'input' && element.type === 'file';
  if (isFileInput(this)) return this;
  if (this.localName === 'label' && isFileInput(this.control)) return this.control;
  const inside = this.querySelectorAll('input[type="file"]');
  return inside.length === 1 ? inside[0] : null;
}`
const DESCRIBE_FILE_INPUT = 'function () { return { disabled: this.disabled, multiple: this.multiple } }'
// SVG and other non-HTML elements have no click method, so they receive the click as an event.
const CLICK = `function () {
  this.scrollIntoView({ block: 'center', inline: 'center' });
  if (typeof this.click === 'function') this.click();
  else this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
}`

interface RemoteObject {
  objectId?: string
  subtype?: string
}

const OWNER_DOCUMENT = 'function () { return this.ownerDocument }'

/**
 * The document node an element belongs to, as a backend node id. Ids are comparable across the
 * JavaScript contexts of frames, unlike the elements themselves.
 */
async function documentNodeOf(page: Cdp, objectId: string, signal: AbortSignal): Promise<number | undefined> {
  const owner = await page.send<{ result: RemoteObject }>(
    'Runtime.callFunctionOn',
    { objectId, functionDeclaration: OWNER_DOCUMENT, objectGroup: OBJECT_GROUP },
    signal
  )
  if (!owner.result.objectId) return undefined
  const described = await page.send<{ node: { backendNodeId?: number } }>(
    'DOM.describeNode',
    { objectId: owner.result.objectId },
    signal
  )
  return described.node.backendNodeId
}

/**
 * Hands `files` to the page's file input through the browser, the way a file picker does: the site
 * receives them with its own input and change events and uploads them with its own requests. A
 * target that is not a file input is clicked, and the file picker it opens receives the files.
 * The target is looked up in the document shown, and the page is touched only while `isCurrent`
 * confirms it is the page the caller validated. A click may change the URL within the document, so
 * after it `isSameDocument` only requires the document to be the same; every later step acts on
 * objects of that document, which stop resolving once it is replaced. `onTouch` runs right before
 * the page is touched.
 */
export async function handFilesToPage(
  page: Cdp,
  target: string,
  files: string[],
  signal: AbortSignal,
  hooks: { isCurrent: () => boolean; isSameDocument: () => boolean; onTouch: () => void }
): Promise<HandFilesOutcome> {
  let restore: Array<[method: string, params?: Record<string, unknown>]> = [
    ['Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }],
  ]
  try {
    const isRef = SNAPSHOT_REF_PATTERN.test(target)
    const expression = isRef
      ? `${PAGE_REFS_SOURCE}.elementFor(${JSON.stringify(target)})`
      : `document.querySelector(${JSON.stringify(target)})`
    const found = await page.send<{ result: RemoteObject; exceptionDetails?: unknown }>(
      'Runtime.evaluate',
      { expression, objectGroup: OBJECT_GROUP },
      signal
    )
    const pageChanged: HandFilesOutcome = {
      kind: 'refused',
      code: 'page_changed',
      message: 'The page changed before the upload. Read it again.',
    }
    if (!hooks.isCurrent()) return pageChanged
    if (found.exceptionDetails) {
      return { kind: 'refused', code: 'target_not_found', message: `Invalid selector: ${target}` }
    }
    const element = found.result.objectId
    if (!element) {
      const message = isRef
        ? `Reference ${target} is not on the page anymore. Take a new snapshot.`
        : `No element matches ${target}`
      return { kind: 'refused', code: 'target_not_found', message }
    }

    const input = await page.send<{ result: RemoteObject }>(
      'Runtime.callFunctionOn',
      { objectId: element, functionDeclaration: FIND_FILE_INPUT, objectGroup: OBJECT_GROUP },
      signal
    )
    const inputId = input.result.subtype === 'null' ? undefined : input.result.objectId
    if (inputId) {
      const described = await page.send<{ result: { value?: { disabled?: boolean; multiple?: boolean } } }>(
        'Runtime.callFunctionOn',
        { objectId: inputId, functionDeclaration: DESCRIBE_FILE_INPUT, returnByValue: true },
        signal
      )
      const { disabled, multiple } = described.result.value ?? {}
      if (disabled) return { kind: 'refused', code: 'target_unsupported', message: 'The file input is disabled.' }
      if (files.length > 1 && !multiple) {
        return { kind: 'refused', code: 'target_unsupported', message: 'The file input accepts a single file.' }
      }
      // Checked again with no wait before the touch, as the page may have moved on during the lookups.
      if (!hooks.isCurrent()) return pageChanged
      hooks.onTouch()
      await page.send('DOM.setFileInputFiles', { objectId: inputId, files }, signal)
      return { kind: 'handed' }
    }

    // Without interception, a click would show the file picker to the user instead. Restoring starts
    // before interception is requested, as an aborted wait does not withdraw a command already sent.
    // A picker the user opens later then shows as usual, and the page stops streaming its events.
    restore = [['Page.setInterceptFileChooserDialog', { enabled: false }], ['Page.disable'], ...restore]
    await page.send('Page.enable', undefined, signal)
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true }, signal)
    if (!hooks.isCurrent()) return pageChanged
    const opened = page.nextEvent<{ mode: 'selectSingle' | 'selectMultiple'; backendNodeId?: number }>(
      'Page.fileChooserOpened',
      FILE_CHOOSER_TIMEOUT_MS,
      signal
    )
    // Rejects with the signal, possibly while the click below still waits; the wait for it reports that.
    void opened.catch(() => undefined)
    hooks.onTouch()
    const clicked = await page.send<{ exceptionDetails?: { exception?: { description?: string } } }>(
      'Runtime.callFunctionOn',
      { objectId: element, functionDeclaration: CLICK, userGesture: true, awaitPromise: false },
      signal
    )
    // A page function that throws resolves with its exception instead of rejecting.
    if (clicked.exceptionDetails) {
      const reason = clicked.exceptionDetails.exception?.description ?? 'The click failed.'
      return { kind: 'failed', code: 'target_unsupported', message: reason.slice(0, 300) }
    }
    const chooser = await opened
    if (!chooser) {
      return {
        kind: 'failed',
        code: 'no_file_chooser',
        message:
          'The target was clicked but no file picker opened. Target the file input, or the control that opens the picker.',
      }
    }
    if (chooser.backendNodeId === undefined) {
      return {
        kind: 'failed',
        code: 'target_unsupported',
        message: 'The page opened a file picker that is not attached to a file input.',
      }
    }
    if (files.length > 1 && chooser.mode === 'selectSingle') {
      return { kind: 'failed', code: 'target_unsupported', message: 'The file picker accepts a single file.' }
    }
    const resolved = await page.send<{ object: RemoteObject }>(
      'DOM.resolveNode',
      { backendNodeId: chooser.backendNodeId, objectGroup: OBJECT_GROUP },
      signal
    )
    const chooserInput = resolved.object.objectId
    // An input of another document, such as one a navigation after the click brought, fails here.
    // The target and the input may live in different frames' contexts, so their documents are
    // compared by node id rather than by passing one element to a function of the other.
    const sameDocument =
      !!chooserInput &&
      (await Promise.all([documentNodeOf(page, element, signal), documentNodeOf(page, chooserInput, signal)]).then(
        ([targetDocument, inputDocument]) => targetDocument !== undefined && targetDocument === inputDocument,
        () => {
          signal.throwIfAborted()
          return false
        }
      ))
    if (!sameDocument || !hooks.isSameDocument()) {
      return {
        kind: 'failed',
        code: 'page_changed',
        message: 'The file picker opened for another document than the target. Read the page again.',
      }
    }
    await page.send('DOM.setFileInputFiles', { objectId: chooserInput, files }, signal)
    return { kind: 'handed' }
  } finally {
    await restorePage(page, restore)
  }
}

/**
 * Undoes what an upload set on the page within a bounded time, so a page that stopped responding
 * cannot hold the upload; when that fails, the debugger session ends, which undoes it as well.
 */
async function restorePage(page: Cdp, commands: Array<[method: string, params?: Record<string, unknown>]>) {
  const signal = AbortSignal.timeout(RESTORE_TIMEOUT_MS)
  try {
    for (const [method, params] of commands) await page.send(method, params, signal)
  } catch {
    page.reset()
  }
}
