import { createHashHistory, createRouter, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { routeTree } from './routeTree.gen'

// Create a new router instance
export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => {
    const navigate = useNavigate()

    useEffect(() => {
      navigate({ to: '/', replace: true }) // 重定向到首页
    }, [navigate])

    return null
  },
  history: createHashHistory(),
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
