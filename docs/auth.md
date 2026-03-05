# Auth Module

Authentication wrapping Supabase Auth.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `getUser(): Promise<User | null>`

Get the currently authenticated user, or `null` if not signed in.

### `getSession(): Promise<Session | null>`

Get the current session.

### `requireUser(): Promise<User>`

Get the current user or throw if not authenticated.

### `onAuthStateChange(callback): Subscription`

Subscribe to auth state changes (sign in, sign out, token refresh).

### `signOut(): Promise<void>`

Sign out the current user.
