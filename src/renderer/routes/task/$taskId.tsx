// Task mode is not available in the open-source edition
import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/task/$taskId')({
  component: () => <Navigate to="/" />,
})
