# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Identity Integrity**: Every document created under `/users/{userId}`, `/users/{userId}/private/{docId}`, and `/users/{userId}/preferences/{prefId}` must bind its `uid` / `ownerId` strictly to `request.auth.uid`, and `userId` in the path must equal `request.auth.uid` (unless `isAdmin()`).
2. **Privilege Escalation Prevention**: A non-admin user creating `/users/{userId}` can only assign `role: "member"` and cannot modify `role` on update. `/admins/{userId}` is writable only by an existing admin.
3. **PII Isolation**: Email addresses live exclusively in `/users/{userId}/private/info` and are readable/writable only by the owner (`request.auth.uid == userId`) or an admin (`isAdmin()`).
4. **Immutable Ownership & Creation Timestamps**: `uid`, `ownerId`, and `createdAt` cannot change after creation; `createdAt` (create) and `updatedAt` (create/update) must equal `request.time`.
5. **Verified Auth & Strict Shapes**: All writes require `request.auth != null && request.auth.token.email_verified == true`. All IDs match `^[a-zA-Z0-9_\-]+$` (`size <= 128`) and all strings obey bounded lengths from `firebase-blueprint.json`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)
1. **Self-Role Escalation on Create** (`/users/u1`): `{ "uid": "u1", "displayName": "Alice", "role": "admin", "createdAt": "<now>", "updatedAt": "<now>" }`
2. **Shadow / Ghost Field Injection** (`/users/u1`): `{ "uid": "u1", "displayName": "Alice", "role": "member", "isVerified": true, "createdAt": "<now>", "updatedAt": "<now>" }`
3. **Spoofed Owner UID** (`/users/u1/preferences/console`): `{ "ownerId": "victim_uid", "theme": "dark", "defaultTab": "overview", "sidebarCollapsed": false, "createdAt": "<now>", "updatedAt": "<now>" }`
4. **Cross-User Write** (`/users/victim/preferences/console` by `attacker`): `{ "ownerId": "attacker", "theme": "dark", "defaultTab": "overview", "sidebarCollapsed": false, "createdAt": "<now>", "updatedAt": "<now>" }`
5. **Unverified Email Spoofing** (`email_verified: false` claiming admin email on `/admins/attacker`): `{ "uid": "attacker", "grantedAt": "<now>" }`
6. **Client-Spoofed Timestamp** (`/users/u1`): `{ "uid": "u1", "displayName": "Alice", "role": "member", "createdAt": "2020-01-01T00:00:00Z", "updatedAt": "2020-01-01T00:00:00Z" }`
7. **Immutable Field Tampering on Update** (`/users/u1` update): `{ "role": "admin", "updatedAt": "<now>" }`
8. **Type Poisoning on Whitelisted Key** (`/users/u1/preferences/console` update): `{ "sidebarCollapsed": "yes", "updatedAt": "<now>" }`
9. **Oversized String / Resource Poisoning** (`/users/u1`): `{ "uid": "u1", "displayName": "<1500 chars>", "role": "member", "createdAt": "<now>", "updatedAt": "<now>" }`
10. **Path ID Poisoning** (`/users/u1/preferences/bad.id$slash`): `{ "ownerId": "u1", "theme": "dark", "defaultTab": "overview", "sidebarCollapsed": false, "createdAt": "<now>", "updatedAt": "<now>" }`
11. **PII Leak Attempt** (`get /users/victim/private/info` by another signed-in user `u1`)
12. **Blanket Unscoped List Query** (`list /users` or `list /admins` by non-admin user)
