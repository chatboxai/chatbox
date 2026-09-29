import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

/** Links and deep links to /settings/general open Appearance. */
export function RouteComponent() {
  return <Navigate to="/settings/appearance" replace />
}
