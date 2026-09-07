import { BrowserAttachmentAdapter } from './BrowserAttachmentAdapter'

/**
 * Capacitor's current picker surface still returns Web File values. Keeping a
 * distinct adapter makes that compatibility boundary explicit and allows a
 * future native picker to change without affecting AttachmentService.
 */
export class CapacitorAttachmentAdapter extends BrowserAttachmentAdapter {}
