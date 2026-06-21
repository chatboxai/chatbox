import {
  executeWebDAVRequest,
  joinWebDAVUrl,
  SYNC_COLLECTION_PATH,
  SYNC_SNAPSHOT_PATH,
  validateWebDAVRequestTarget,
} from '@shared/sync-webdav'
import type { WebDAVRequest, WebDAVResponse } from './types'

export { executeWebDAVRequest, joinWebDAVUrl, SYNC_COLLECTION_PATH, SYNC_SNAPSHOT_PATH, validateWebDAVRequestTarget }

type WebDAVCapablePlatform = {
  webdavRequest?: (request: WebDAVRequest, baseUrl: string) => Promise<WebDAVResponse>
}

export function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

export function requestWebDAV(
  platform: WebDAVCapablePlatform,
  baseUrl: string,
  request: WebDAVRequest
): Promise<WebDAVResponse> {
  validateWebDAVRequestTarget(baseUrl, request)
  if (!platform.webdavRequest) {
    throw new Error('WebDAV sync is not supported on this platform')
  }
  return platform.webdavRequest(request, baseUrl)
}
