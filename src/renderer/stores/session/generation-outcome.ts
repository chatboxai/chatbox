export type GenerationOutcome =
  | { status: 'completed' }
  | { status: 'stopped' }
  | { status: 'failed'; error: string }
  | { status: 'tool-paused' }

export interface SubmissionOutcome {
  committed: boolean
  generation: GenerationOutcome
}
