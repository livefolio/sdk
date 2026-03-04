# Getting Started

## Installation

```bash
npm install @livefolio/sdk @supabase/supabase-js
```

## Setup

The SDK requires a typed Supabase client. Create one and pass it to `createLivefolioClient`:

```ts
import { createClient } from '@supabase/supabase-js';
import { createLivefolioClient } from '@livefolio/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const livefolio = createLivefolioClient(supabase);
```

This gives you access to all four modules:

```ts
livefolio.auth       // Authentication
livefolio.market     // Market data
livefolio.strategy   // Strategy evaluation
livefolio.portfolio  // Portfolio management (stub)
```

## Importing individual modules

You can also import module factories directly:

```ts
import { createMarket } from '@livefolio/sdk/market';
import { createStrategy } from '@livefolio/sdk/strategy';
import { createAuth } from '@livefolio/sdk/auth';
```

## TypedSupabaseClient

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@livefolio/db';

type TypedSupabaseClient = SupabaseClient<Database>;
```

All module factories accept this as their sole argument.
