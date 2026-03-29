import { describe, it, expect } from 'vitest';
import { createClient, type LivefolioClient } from './index.js';

const TEST_OPTIONS = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseKey: 'test-anon-key',
};

describe('createClient', () => {
  it('returns a LivefolioClient', () => {
    const client: LivefolioClient = createClient(TEST_OPTIONS);
    expect(client).toBeDefined();
    expect(typeof client).toBe('object');
  });

  it('does not expose supabase on the returned client', () => {
    const client = createClient(TEST_OPTIONS);
    expect(client).not.toHaveProperty('supabase');
    expect(client).not.toHaveProperty('_supabase');
  });
});
