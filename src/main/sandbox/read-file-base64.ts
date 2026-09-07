import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { formatTooLargeFileRead, readRegularFileBytesBounded } from '../bounded-file-read'

export interface ReadSandboxFileParams {
  filePath: string
  maxBytes?: number
}

/** Read a regular, non-symlink file only after proving it belongs to an allowed sandbox root. */
export async function readSandboxFileBytes(
  params: ReadSandboxFileParams,
  sandboxRoots: string[]
): Promise<{ success: true; bytes: Buffer } | { success: false; error: string }> {
  const fileStat = await lstat(params.filePath)
  if (fileStat.isSymbolicLink()) {
    return { success: false, error: 'Access denied: symlinks not allowed' }
  }
  const resolved = await realpath(params.filePath)
  const isInsideSandbox = sandboxRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
  if (!isInsideSandbox) {
    return { success: false, error: 'Access denied: path outside sandbox directory' }
  }
  const result = await readRegularFileBytesBounded(resolved, params.maxBytes)
  if (result.success) return result
  if (result.reason === 'not-regular-file') {
    return { success: false, error: 'Access denied: path is not a regular file' }
  }
  return { success: false, error: formatTooLargeFileRead(result, 'File') }
}

/** Return only the bytes owned by this Buffer, without exposing unused pooled memory. */
export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

/** Compatibility path used by HTML/artifact previews that still consume data URLs. */
export async function readSandboxFileBase64(
  params: ReadSandboxFileParams,
  sandboxRoots: string[]
): Promise<{ success: true; base64: string } | { success: false; error: string }> {
  const result = await readSandboxFileBytes(params, sandboxRoots)
  if (!result.success) return result
  return { success: true, base64: result.bytes.toString('base64') }
}
