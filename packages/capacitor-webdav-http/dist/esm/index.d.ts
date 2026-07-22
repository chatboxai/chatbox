export interface WebDAVHttpRequestOptions {
  baseUrl: string
  url: string
  method: 'GET' | 'PUT' | 'MKCOL' | 'PROPFIND' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface WebDAVHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface WebDAVHttpPlugin {
  request(options: WebDAVHttpRequestOptions): Promise<WebDAVHttpResponse>
}

export declare const WebDAVHttp: WebDAVHttpPlugin
