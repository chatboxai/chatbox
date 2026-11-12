import type { TFunction } from 'i18next'
import type { SystemToolDetails } from './system-tools'

/** Dates use the device time zone; timed events include its name in the confirmation. */
export function formatSystemToolDetails(details: SystemToolDetails, t: TFunction, locale?: string): string {
  const date = (value: number, allDay = false) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(allDay ? {} : { hour: '2-digit' as const, minute: '2-digit' as const, timeZoneName: 'short' as const }),
    }).format(value)
  switch (details.action) {
    case 'photos_select':
      return t('Choose photos for this conversation.')
    case 'photos_save':
      return t('Save {{filename}} to Photos.', { filename: details.filename })
    case 'calendar_read':
      return t('Read calendar events from {{start}} to {{end}}.', {
        start: date(details.start),
        end: date(details.end),
      })
    case 'calendar_create':
    case 'calendar_update':
      return [
        details.action === 'calendar_create'
          ? t('Create calendar event “{{title}}”.', { title: details.title })
          : t('Update calendar event “{{title}}”.', { title: details.title }),
        t('From {{start}} to {{end}}.', {
          start: date(details.start, details.allDay),
          end: date(details.end, details.allDay),
        }),
        details.allDay ? t('All day (end date excluded)') : '',
      ]
        .filter(Boolean)
        .join('\n')
    case 'reminders_read':
      return details.completed ? t('Read completed reminders.') : t('Read incomplete reminders.')
    case 'reminders_create':
      return [
        t('Create reminder “{{title}}”.', { title: details.title }),
        details.due === undefined ? '' : t('Due: {{date}}', { date: date(details.due) }),
      ]
        .filter(Boolean)
        .join('\n')
    case 'reminders_complete':
      return details.completed
        ? t('Mark “{{title}}” as completed.', { title: details.title })
        : t('Mark “{{title}}” as incomplete.', { title: details.title })
    case 'health_summary': {
      const kinds = { steps: t('Steps'), sleep: t('Sleep'), workouts: t('Workouts') }
      return t('Read {{kind}} from {{start}} to {{end}}.', {
        kind: kinds[details.kind],
        start: date(details.start),
        end: date(details.end),
      })
    }
  }
}
