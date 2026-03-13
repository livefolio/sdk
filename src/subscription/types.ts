// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Subscription {
  userId: string;
  strategyId: number;
  strategyLinkId: string;
  accountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionWithEmail extends Subscription {
  email: string;
}

// ---------------------------------------------------------------------------
// Module interface
// ---------------------------------------------------------------------------

export interface SubscriptionModule {
  subscribe(strategyLinkId: string, accountId?: string): Promise<void>;
  unsubscribe(strategyLinkId: string): Promise<void>;
  list(): Promise<Subscription[]>;
  get(strategyLinkId: string): Promise<Subscription | null>;
  count(): Promise<number>;

  // Admin (service_role) methods
  listAll(): Promise<SubscriptionWithEmail[]>;
  listApprovedAutoDeployUserIds(): Promise<Set<string>>;
}
