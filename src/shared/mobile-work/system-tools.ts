import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { throwIfWorkAborted } from './abort'

export type SystemToolGroupId = 'calendar' | 'reminders' | 'photos' | 'health'

export interface SystemToolAuthorization {
  capability: SystemToolGroupId
  operation: 'read' | 'write'
  disclosure: 'model' | 'health-model'
  details: SystemToolDetails
}

export type SystemToolDetails =
  | { action: 'photos_select' }
  | { action: 'photos_save'; filename: string }
  | { action: 'calendar_read'; start: number; end: number }
  | { action: 'calendar_create' | 'calendar_update'; title: string; start: number; end: number; allDay: boolean }
  | { action: 'reminders_read'; completed: boolean }
  | { action: 'reminders_create'; title: string; due?: number }
  | { action: 'reminders_complete'; title: string; completed: boolean }
  | { action: 'health_summary'; kind: 'steps' | 'sleep' | 'workouts'; start: number; end: number }

export interface PickedWorkPhoto {
  uri: string
  filename: string
  mimeType: string
}

export interface SystemToolContext {
  pickPhotos(): Promise<PickedWorkPhoto[] | null>
  /** UI owns consent. Health consent must identify the current model's provider before returning true. */
  authorize(request: SystemToolAuthorization): Promise<boolean>
  /** Copy the selected image into this session's workspace; return a workspace-relative path, never a device URI. */
  importPhoto(asset: { uri: string; filename: string; mimeType: string }): Promise<{ path: string }>
  /** Resolve only a session-owned image and copy it to the application cache for native export. */
  preparePhotoExport(path: string): Promise<{ uri: string; cleanup(): Promise<void> }>
  signal?: AbortSignal
}

export interface SystemToolGroup {
  id: SystemToolGroupId
  description: string
  load(): Promise<ToolSet>
}

export interface MobileSystemToolsNative {
  calendarRead(start: number, end: number): Promise<unknown>
  calendarSave(id: string | null, title: string, start: number, end: number, allDay: boolean): Promise<string>
  remindersRead(completed: boolean): Promise<unknown>
  reminderCreate(title: string, due: number | null): Promise<string>
  reminderComplete(id: string, completed: boolean): Promise<boolean>
  photoSave(uri: string): Promise<boolean>
  healthRead(kind: string, start: number, end: number): Promise<unknown>
}

const timestamp = z.number().finite().min(-8640000000000000).max(8640000000000000)
const title = z.string().trim().min(1).max(500)
const identifier = z.string().min(1).max(1024)
const period = {
  start: timestamp.describe('Unix milliseconds, inclusive'),
  end: timestamp.describe('Unix milliseconds, exclusive'),
}
const validRange = (value: { start: number; end: number }) =>
  value.end > value.start && value.end - value.start <= 366 * 86400000
const rangeError = 'Choose an increasing date range of at most 366 days'

export function createMobileSystemToolGroups(
  context: SystemToolContext,
  native: MobileSystemToolsNative | null
): SystemToolGroup[] {
  const reminderTitles = new Map<string, string>()
  function makeTool<S extends z.ZodType>(
    capability: SystemToolGroupId,
    operation: 'read' | 'write',
    description: string,
    schema: S,
    details: (args: z.output<S>) => SystemToolDetails,
    execute: (args: z.output<S>) => Promise<unknown>
  ) {
    return tool({
      description,
      inputSchema: schema,
      execute: async (input, options) => {
        const args = schema.parse(input)
        const checkAborted = () => {
          throwIfWorkAborted(context.signal)
          throwIfWorkAborted(options?.abortSignal)
        }
        checkAborted()
        const allowed = await context.authorize({
          capability,
          operation,
          disclosure: capability === 'health' ? 'health-model' : 'model',
          details: details(args),
        })
        checkAborted()
        if (!allowed) return { status: 'declined' }
        const result = await execute(args)
        // OS writes may already be committed; preserve their result so callers do not retry an applied action.
        if (operation === 'read') checkAborted()
        return result
      },
    })
  }

  const groups: SystemToolGroup[] = [
    {
      id: 'photos',
      description: 'Choose photos for the session workspace and save generated images to Photos on iOS.',
      async load() {
        const tools: ToolSet = {
          photos_select: makeTool(
            'photos',
            'read',
            'Open the system picker. The user chooses up to ten images to import into this session.',
            z.object({}),
            () => ({ action: 'photos_select' }),
            async () => {
              const photos = await context.pickPhotos()
              if (!photos) return { status: 'canceled', files: [] }
              const files = []
              for (const asset of photos.slice(0, 10)) {
                throwIfWorkAborted(context.signal)
                files.push(await context.importPhoto(asset))
              }
              return { files }
            }
          ),
        }
        if (native)
          tools.photos_save = makeTool(
            'photos',
            'write',
            'Save a session workspace image to the iOS photo library.',
            z.object({ path: z.string().min(1).max(1024) }),
            (args) => ({ action: 'photos_save', filename: args.path.split('/').pop() ?? args.path }),
            async (args) => {
              const prepared = await context.preparePhotoExport(args.path)
              try {
                return { saved: await native.photoSave(prepared.uri) }
              } finally {
                await prepared.cleanup()
              }
            }
          )
        return tools
      },
    },
  ]
  if (!native) return groups
  groups.push(
    {
      id: 'calendar',
      description: 'Read up to 100 calendar events or create and update one event.',
      async load() {
        return {
          calendar_read: makeTool(
            'calendar',
            'read',
            'Read calendar events in a bounded date range. Returns the earliest 100 events.',
            z.object(period).refine(validRange, rangeError),
            (args) => ({ action: 'calendar_read', ...args }),
            (args) => native.calendarRead(args.start, args.end)
          ),
          calendar_save: makeTool(
            'calendar',
            'write',
            'Create an event or update a nonrecurring event. Recurring events must be edited in Calendar. Omit id to create.',
            z
              .object({ ...period, id: identifier.optional(), title, allDay: z.boolean().default(false) })
              .refine(validRange, rangeError),
            (args) => ({ ...args, action: args.id ? 'calendar_update' : 'calendar_create' }),
            async (args) => ({
              id: await native.calendarSave(args.id ?? null, args.title, args.start, args.end, args.allDay),
            })
          ),
        }
      },
    },
    {
      id: 'reminders',
      description: 'Read up to 100 reminders, create a reminder, or change its completion state.',
      async load() {
        return {
          reminders_read: makeTool(
            'reminders',
            'read',
            'Read up to 100 reminders with the specified completion state.',
            z.object({ completed: z.boolean().default(false) }),
            (args) => ({ action: 'reminders_read', completed: args.completed }),
            async (args) => {
              const records = await native.remindersRead(args.completed)
              const parsed = z.array(z.object({ id: z.string(), title: z.string() })).safeParse(records)
              if (parsed.success) for (const record of parsed.data) reminderTitles.set(record.id, record.title)
              return records
            }
          ),
          reminders_create: makeTool(
            'reminders',
            'write',
            'Create a reminder, optionally with a due time and notification.',
            z.object({ title, due: timestamp.optional() }),
            (args) => ({ action: 'reminders_create', ...args }),
            async (args) => {
              const id = await native.reminderCreate(args.title, args.due ?? null)
              reminderTitles.set(id, args.title)
              return { id }
            }
          ),
          reminders_complete: makeTool(
            'reminders',
            'write',
            'Set a reminder completed or incomplete. First read reminders in this request to confirm the target title.',
            z.object({ id: identifier, completed: z.boolean() }),
            (args) => {
              const title = reminderTitles.get(args.id)
              if (title === undefined) throw new Error('Read reminders before changing their completion state')
              return { action: 'reminders_complete', title, completed: args.completed }
            },
            async (args) => ({ updated: await native.reminderComplete(args.id, args.completed) })
          ),
        }
      },
    },
    {
      id: 'health',
      description:
        'Read local step totals, sleep duration, or workout summaries after explicit consent to disclose the summary to the current model provider.',
      async load() {
        return {
          health_summary: makeTool(
            'health',
            'read',
            'Read a summary for one health data type. Empty results mean no readable data, never proof of denied permission or absent records. Sleep/workout summaries may be truncated.',
            z.object({ ...period, kind: z.enum(['steps', 'sleep', 'workouts']) }).refine(validRange, rangeError),
            (args) => ({ action: 'health_summary', ...args }),
            (args) => native.healthRead(args.kind, args.start, args.end)
          ),
        }
      },
    }
  )
  return groups
}
