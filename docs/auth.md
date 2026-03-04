# Auth Module

Wraps Supabase Auth with a streamlined interface.

## Methods

### `getUser()`

Returns the currently authenticated user, or `null` if not signed in.

```ts
const user = await livefolio.auth.getUser();
// User | null
```

**Throws** if Supabase returns an error (e.g. network failure).

---

### `getSession()`

Returns the current session, or `null` if not signed in.

```ts
const session = await livefolio.auth.getSession();
// Session | null
```

**Throws** if Supabase returns an error.

---

### `requireUser()`

Same as `getUser()` but throws if no user is authenticated. Use this when you need a guaranteed `User` object.

```ts
const user = await livefolio.auth.requireUser();
// User (never null)
```

**Throws** `Error('Not authenticated')` if no user is signed in, or rethrows Supabase errors.

---

### `onAuthStateChange(callback)`

Registers a listener for auth state changes (sign in, sign out, token refresh, etc.).

| Parameter  | Type                                                   |
|------------|--------------------------------------------------------|
| `callback` | `(event: AuthChangeEvent, session: Session \| null) => void` |

**Returns** `Subscription` — call `.unsubscribe()` to remove the listener.

```ts
const subscription = livefolio.auth.onAuthStateChange((event, session) => {
  console.log('Auth event:', event);
  if (session) {
    console.log('User:', session.user.email);
  }
});

// Later: clean up
subscription.unsubscribe();
```

---

### `signOut()`

Signs out the current user and invalidates the session.

```ts
await livefolio.auth.signOut();
```

**Throws** if Supabase returns an error.

## Types

All types are re-exported from `@supabase/supabase-js`:

- `User` — Supabase user object
- `Session` — Supabase session object
- `AuthChangeEvent` — auth lifecycle event string
- `Subscription` — auth subscription handle with `.unsubscribe()`
