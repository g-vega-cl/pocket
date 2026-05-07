import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryClient } from '../query-client.js'

describe('queryClient', () => {
  it('is a QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })
})
