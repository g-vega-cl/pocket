import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { queryClient } from '#/shared/api/query-client.js'

function QueryClientConsumer() {
  const client = useQueryClient()
  return <div data-testid="consumer">{client ? 'present' : 'missing'}</div>
}

describe('QueryClientProvider', () => {
  it('shared queryClient is valid', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  it('useQueryClient is accessible within QueryClientProvider', () => {
    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <QueryClientConsumer />
      </QueryClientProvider>,
    )
    expect(getByTestId('consumer')).toHaveTextContent('present')
  })
})
