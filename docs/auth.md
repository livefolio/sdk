# Auth Module

Authentication wrapping Supabase Auth.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `getUser(): Promise<User | null>`

Get the currently authenticated user, or `null` if not signed in.

```ts
const user = await lf.auth.getUser();
if (user) console.log(user.email);
```

### `getSession(): Promise<Session | null>`

Get the current session.

```ts
const session = await lf.auth.getSession();
if (session) console.log(session.access_token);
```

### `requireUser(): Promise<User>`

Get the current user or throw if not authenticated.

```ts
const user = await lf.auth.requireUser(); // throws if not signed in
```

### `onAuthStateChange(callback): Subscription`

Subscribe to auth state changes (sign in, sign out, token refresh).

```ts
const subscription = lf.auth.onAuthStateChange((event, session) => {
  console.log(event, session?.user?.email);
});
```

### `signOut(): Promise<void>`

Sign out the current user.

```ts
await lf.auth.signOut();
```
