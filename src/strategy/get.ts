import type { TypedSupabaseClient } from '../types';
import type { Strategy } from './types';

export async function get(client: TypedSupabaseClient, linkId: string): Promise<Strategy | null> {
  const { data, error } = await client.functions.invoke('strategy', {
    body: { linkId },
  });
  if (error || !data) return null;
  return data as Strategy;
}

export async function getMany(client: TypedSupabaseClient, linkIds: string[]): Promise<Record<string, Strategy>> {
  if (linkIds.length === 0) return {};

  const result: Record<string, Strategy> = {};
  const promises = linkIds.map(async (id) => {
    const strategy = await get(client, id);
    if (strategy) result[id] = strategy;
  });
  await Promise.all(promises);
  return result;
}
