import { describe, it, expect } from 'vitest';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient, type LivefolioClient } from './index.js';

function createTestSupabase() {
  return createSupabaseClient('https://test.supabase.co', 'test-anon-key');
}

describe('createClient', () => {
  it('returns a LivefolioClient', () => {
    const client: LivefolioClient = createClient({
      supabase: createTestSupabase(),
    });
    expect(client).toBeDefined();
    expect(typeof client).toBe('object');
  });

  it('does not expose supabase on the returned client', () => {
    const client = createClient({
      supabase: createTestSupabase(),
    });
    expect(client).not.toHaveProperty('supabase');
    expect(client).not.toHaveProperty('_supabase');
  });
});
