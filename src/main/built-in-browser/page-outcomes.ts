import type {
  BuiltInBrowserDownload,
  BuiltInBrowserPageEvents,
  BuiltInBrowserSettledOperation,
} from '@shared/built-in-browser'

/**
 * Runs and downloads that ended after the result that could have reported them, waiting for the
 * model's next result. The pages of one conversation share it, so an outcome reaches the model
 * whichever tab its next result comes from, even after the tab that produced it has closed.
 */
export class PendingOutcomes {
  private settled: BuiltInBrowserSettledOperation[] = []
  private downloads: BuiltInBrowserDownload[] = []

  addSettled(operation: BuiltInBrowserSettledOperation): void {
    this.settled.push(operation)
  }

  /** With `limit`, the download is dropped once that many are waiting, for diagnostics that can pile up. */
  addDownload(download: BuiltInBrowserDownload, limit?: number): void {
    if (limit !== undefined && this.downloads.length >= limit) return
    this.downloads.push(download)
  }

  /** Every waiting outcome; each is handed out once. */
  take(): Pick<BuiltInBrowserPageEvents, 'settledOperations' | 'downloads'> {
    const { settled, downloads } = this
    this.settled = []
    this.downloads = []
    return {
      ...(settled.length ? { settledOperations: settled } : {}),
      ...(downloads.length ? { downloads } : {}),
    }
  }
}

/** Where a page reports what ends after its results: the shared queue, and the tab it shows in. */
export interface PageOutcomeTarget {
  outcomes: PendingOutcomes
  /** Tags the page's references and outcomes; absent for a page outside any tab. */
  tab?: string
}
