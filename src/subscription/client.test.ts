import { describe, it, expect, vi } from 'vitest';
import { createSubscription } from './client';
import * as storage from './storage';

vi.mock('./storage', () => ({
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  listByUser: vi.fn().mockResolvedValue([]),
  getByUserAndStrategy: vi.fn().mockResolvedValue(null),
  countByUser: vi.fn().mockResolvedValue(0),
  listAll: vi.fn().mockResolvedValue([]),
  listApprovedAutoDeployUserIds: vi.fn().mockResolvedValue(new Set()),
}));

function createMockClient() {
  return { from: vi.fn() } as any;
}

describe('createSubscription', () => {
  it('returns a module with all expected methods', () => {
    const mod = createSubscription(createMockClient(), 'user-1');

    expect(typeof mod.subscribe).toBe('function');
    expect(typeof mod.unsubscribe).toBe('function');
    expect(typeof mod.list).toBe('function');
    expect(typeof mod.get).toBe('function');
    expect(typeof mod.count).toBe('function');
    expect(typeof mod.listAll).toBe('function');
    expect(typeof mod.listApprovedAutoDeployUserIds).toBe('function');
  });

  it('delegates subscribe to storage', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.subscribe('link-abc', 'acct-1');

    expect(storage.subscribe).toHaveBeenCalledWith(client, 'user-1', 'link-abc', 'acct-1');
  });

  it('delegates subscribe without accountId', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.subscribe('link-abc');

    expect(storage.subscribe).toHaveBeenCalledWith(client, 'user-1', 'link-abc', undefined);
  });

  it('delegates unsubscribe to storage', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.unsubscribe('link-abc');

    expect(storage.unsubscribe).toHaveBeenCalledWith(client, 'user-1', 'link-abc');
  });

  it('delegates list to storage.listByUser', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.list();

    expect(storage.listByUser).toHaveBeenCalledWith(client, 'user-1');
  });

  it('delegates get to storage.getByUserAndStrategy', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.get('link-abc');

    expect(storage.getByUserAndStrategy).toHaveBeenCalledWith(client, 'user-1', 'link-abc');
  });

  it('delegates count to storage.countByUser', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.count();

    expect(storage.countByUser).toHaveBeenCalledWith(client, 'user-1');
  });

  it('delegates listAll to storage.listAll', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.listAll();

    expect(storage.listAll).toHaveBeenCalledWith(client);
  });

  it('delegates listApprovedAutoDeployUserIds to storage', async () => {
    const client = createMockClient();
    const mod = createSubscription(client, 'user-1');

    await mod.listApprovedAutoDeployUserIds();

    expect(storage.listApprovedAutoDeployUserIds).toHaveBeenCalledWith(client);
  });

  describe('without userId', () => {
    it('throws on subscribe', () => {
      const mod = createSubscription(createMockClient());
      expect(() => mod.subscribe('link-abc')).toThrow('Authenticated user required');
    });

    it('throws on unsubscribe', () => {
      const mod = createSubscription(createMockClient());
      expect(() => mod.unsubscribe('link-abc')).toThrow('Authenticated user required');
    });

    it('throws on list', () => {
      const mod = createSubscription(createMockClient());
      expect(() => mod.list()).toThrow('Authenticated user required');
    });

    it('throws on get', () => {
      const mod = createSubscription(createMockClient());
      expect(() => mod.get('link-abc')).toThrow('Authenticated user required');
    });

    it('throws on count', () => {
      const mod = createSubscription(createMockClient());
      expect(() => mod.count()).toThrow('Authenticated user required');
    });

    it('allows listAll without userId', async () => {
      const client = createMockClient();
      const mod = createSubscription(client);

      await mod.listAll();

      expect(storage.listAll).toHaveBeenCalledWith(client);
    });

    it('allows listApprovedAutoDeployUserIds without userId', async () => {
      const client = createMockClient();
      const mod = createSubscription(client);

      await mod.listApprovedAutoDeployUserIds();

      expect(storage.listApprovedAutoDeployUserIds).toHaveBeenCalledWith(client);
    });
  });
});
