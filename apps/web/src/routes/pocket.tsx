import { createFileRoute } from '@tanstack/react-router'
import { PocketApp } from '#/components/PocketApp'

export const Route = createFileRoute('/pocket')({
  component: PocketApp,
})
