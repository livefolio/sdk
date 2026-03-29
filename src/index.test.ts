import { describe, it, expect } from 'vitest';
import { createClient, type LivefolioClient, type TypedSupabaseClient } from './index.js';

describe('createClient', () => {
  it('returns a LivefolioClient', () => {
    const supabase = {} as TypedSupabaseClient;
    const client: LivefolioClient = createClient(supabase);
    expect(client).toBeDefined();
    expect(typeof client).toBe('object');
  });

  it('does not expose supabase on the returned client', () => {
    const supabase = {} as TypedSupabaseClient;
    const client = createClient(supabase);
    expect(client).not.toHaveProperty('supabase');
  });
});
