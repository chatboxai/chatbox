/**
 * Raw persistence boundary for global settings.
 *
 * The application layer owns schema validation, migrations and the persisted
 * envelope. Hosts only provide storage for the historical `settings` value.
 */
export interface SettingsStoragePort {
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
  remove(): Promise<void>
}
