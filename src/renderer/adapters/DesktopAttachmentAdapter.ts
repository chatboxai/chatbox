import { BrowserAttachmentAdapter } from './BrowserAttachmentAdapter'

/**
 * Desktop resolves Electron's native path into PickedAsset.uri while the
 * Browser File object remains private to this adapter.
 */
export class DesktopAttachmentAdapter extends BrowserAttachmentAdapter {
  constructor(resolveNativePath: (file: File) => string) {
    super(resolveNativePath)
  }
}
