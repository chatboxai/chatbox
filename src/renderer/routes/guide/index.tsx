// Guide page is not available in the open-source edition
import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/guide/')({
  component: () => <Navigate to="/" />,
})
