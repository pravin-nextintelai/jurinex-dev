# Sales Referrals — User-side (Signup) API Reference

**Date:** 2026-10-12 · **Backend:** Node.js · **Database:** `authdb` (PostgreSQL) · **Frontend:** JuriNex (React)

## Contents

1. [Overview](#1-overview)
2. [Common rules](#2-common-rules)
3. [U1. Check referral code status](#3-u1-check-referral-code-status)
4. [U2. Register (referral code added)](#4-u2-register-referral-code-added)
5. [Frontend behaviour contract](#5-frontend-behaviour-contract)
6. [Test cases](#6-test-cases)
7. [Open points](#7-open-points)

---

## 1. Overview

The customer-facing side of Sales Referrals is two public APIs and one new field on the signup page. A customer either arrives through a referral link (`<app URL>/#/signup?ref=SFY-7K2Q`) with the code already filled in, or clicks **Have a referral code?** and types one. The code is optional, is checked as the customer types, and is saved against the new workspace at signup. Signup never fails because of a code.

| Item | Value |
| --- | --- |
| Backend | Node.js (existing auth service) |
| Database | `authdb` (PostgreSQL); connection settings read from `.env` |
| Base path | `/api/v1/auth` (already public; no login needed) |
| Authentication | None. Both APIs are called before the customer has an account. |
| Content type | `application/json; charset=utf-8` |
| Rate limiting | In-process, per IP, no Redis (see 2.3) |
| Privacy | The sales owner's name or ID is never returned to the customer |

### API index

| # | Method | Path | Purpose | Used by (screen → action) |
| --- | --- | --- | --- | --- |
| U1 | GET | `/referral-codes/{code}/status` | Tell the signup page whether a code is valid, invalid or inactive | Signup → link opened, saved code restored, typing (400 ms pause), leaving the field |
| U2 | POST | `/register` (existing) | Create the account and save the referral against the new workspace | Signup → **Sign Up** |

Tables used (created by the admin-side migration): `referral_codes` (read by U1 and U2) and `tenant_referrals` (written by U2). See the admin API reference, section 2.1, for the full schema.

---

## 2. Common rules

### 2.1 Code normalisation

Every code is trimmed and upper-cased before use. A valid code matches `^[A-Z0-9-]{6,20}$`. Storage is always upper case, so `sfy-7k2q` and `SFY-7K2Q` are the same code.

### 2.2 What the customer may learn

U1 returns only `VALID`, `INVALID` or `INACTIVE`. It never returns the owner's name, ID, label or any other code data. U2's response is unchanged and says nothing about the referral.

### 2.3 Rate limiting without Redis

U1 is public, so it is limited to stop people guessing codes.

| Setting | Value |
| --- | --- |
| Library | `express-rate-limit` (or `@fastify/rate-limit` on Fastify) with its default in-memory store |
| Scope | Applied to the U1 route only, not to the whole `/auth` router |
| Key | Client IP (`req.ip`). Set `app.set('trust proxy', ...)` to match the gateway/load balancer so the real client IP is used. |
| Limit | 30 requests per IP per 60 seconds |
| Over the limit | `429` with `errorCode: RATE_LIMITED` |

Note: the in-memory store is per Node process. With N instances behind a load balancer, one IP can make up to N × 30 checks a minute. The risk is low because U1 never reveals the owner, so this is acceptable. If a stricter global limit is needed later, a Postgres-backed store can replace the in-memory one without changing the API.

### 2.4 Error envelope

Same envelope as the rest of the backend:

```json
{
  "errorCode": "RATE_LIMITED",
  "message": "Too many attempts. Try again in a minute.",
  "timestamp": "2026-10-12T15:20:00+05:30"
}
```

---

## 3. U1. Check referral code status

`GET /api/v1/auth/referral-codes/{code}/status`

**Purpose:** Lets the signup page show "Referral code applied", "This code isn't valid." or "This code is no longer active." before the customer submits.

**Used by:** Signup page, when:

- the page opens with `?ref=` in the URL;
- a code remembered from an earlier link visit is restored;
- the customer stops typing for 400 ms and the field has at least 6 characters;
- the customer leaves the field and it has not been checked yet.

**Request**

| Part | Name | Type | Required | Rule |
| --- | --- | --- | --- | --- |
| Path | `code` | string | Yes | URL-encoded. Any case. |

```
GET /api/v1/auth/referral-codes/SFY-7K2Q/status
```

**Logic**

1. Rate limiter runs first (2.3). Over the limit → `429 RATE_LIMITED`.
2. Normalise the code (trim, upper-case).
3. If it does not match `^[A-Z0-9-]{6,20}$`, return `INVALID` straight away; no database query.
4. Look it up:

   ```sql
   SELECT active FROM referral_codes WHERE code = $1 LIMIT 1;
   ```

5. Map the result:
   - no row → `INVALID`
   - `active = true` → `VALID`
   - `active = false` → `INACTIVE` (deactivated or refreshed)
6. Return only the status. Send `Cache-Control: no-store` so a deactivation shows up immediately.

**Response `200 OK`**

```json
{ "status": "VALID" }
```

| `status` | Meaning | Signup page shows |
| --- | --- | --- |
| `VALID` | Code exists and is active | ✓ Referral code applied |
| `INVALID` | Wrong format, typo, or never existed | This code isn't valid. + **Remove code** |
| `INACTIVE` | Code was deactivated or refreshed | This code is no longer active. + **Remove code** |

**Errors**

| HTTP | `errorCode` | When |
| --- | --- | --- |
| 429 | `RATE_LIMITED` | More than 30 checks from one IP in 60 seconds |
| 500 | existing generic error | Database unavailable |

An invalid code is **not** an error: it is a `200` with `status: INVALID`.

---

## 4. U2. Register (referral code added)

`POST /api/v1/auth/register` (existing endpoint)

**Purpose:** Creates the workspace and its first user exactly as today, and records which referral code (if any) the workspace signed up with.

**Used by:** Signup page → **Sign Up**.

**Request body:** the existing fields plus one optional field.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| *(existing fields)* | | | Unchanged |
| `referralCode` | string | No | Any value accepted. Never causes a validation error. |

```json
{
  "fullName": "Anil Kapoor",
  "email": "a.kapoor@example.com",
  "workspaceName": "Kapoor Law Chambers",
  "phone": "+91XXXXXXXXXX",
  "password": "********",
  "captchaToken": "...",
  "referralCode": "SFY-7K2Q"
}
```

Clients that do not send `referralCode` keep working unchanged.

**Validation rule for `referralCode`:** do not add a strict validator. If the value is missing, `null`, not a string, empty after trimming, or longer than 50 characters, treat it as absent. The request must never be rejected because of this field.

**Logic** (inside the existing register transaction, after the tenant row is inserted)

1. Normalise `referralCode` (trim, upper-case). If absent or wrong format, `codeId = null`.
2. Otherwise look up the code on the same transaction client:

   ```sql
   SELECT id FROM referral_codes WHERE code = $1 AND active = true LIMIT 1;
   ```

   Found → `codeId = id`. Not found or inactive → `codeId = null`, and log a warning (`referral code ignored at signup`, with the code and tenant ID).
3. Insert the attribution row for **every** self-signup, with or without a code:

   ```sql
   INSERT INTO tenant_referrals (tenant_id, code_id, source, signed_up_at)
   VALUES ($1, $2, 'SIGNUP', now());
   ```

   `code_id = null` means Direct.
4. Wrap steps 2–3 in a savepoint so a referral failure can never cancel the signup. In Postgres, any failed statement aborts the whole transaction, so a plain `try/catch` is not enough:

   ```js
   await client.query('SAVEPOINT referral');
   try {
     const codeId = await findActiveCodeId(client, referralCode); // null if none
     await client.query(
       `INSERT INTO tenant_referrals (tenant_id, code_id, source, signed_up_at)
        VALUES ($1, $2, 'SIGNUP', now())`,
       [tenant.id, codeId]
     );
     await client.query('RELEASE SAVEPOINT referral');
   } catch (err) {
     await client.query('ROLLBACK TO SAVEPOINT referral');
     logger.warn({ err, tenantId: tenant.id }, 'referral attribution skipped');
   }
   ```

5. Continue the existing register flow (CAPTCHA, email verification, response) unchanged.

**Response:** unchanged from today. Nothing about the referral is returned.

**Errors:** no new errors. All existing register errors (CAPTCHA, email taken, etc.) behave as before.

**Edge cases**

| Situation | Result |
| --- | --- |
| No `referralCode` sent | Workspace saved as Direct |
| Typo or unknown code | Signup succeeds; Direct; warning logged |
| Code deactivated between the check and Sign Up | Signup succeeds; Direct |
| Lower-case or padded code (`" sfy-7k2q "`) | Normalised; counted under `SFY-7K2Q` |
| Referral insert fails for any reason | Rolled back to savepoint; signup still succeeds |
| Invited team member joins later | Not a signup; no new `tenant_referrals` row |
| Unverified workspace deleted after 24 h by cleanup job | Its `tenant_referrals` row is removed by `ON DELETE CASCADE` |

---

## 5. Frontend behaviour contract

What the signup page must do so it works correctly with U1 and U2.

### 5.1 Where the code comes from (priority order)

1. `?ref=` in the URL. JuriNex uses hash routing, so read it from the hash part: `#/signup?ref=SFY-7K2Q`. A link code always wins and overwrites any remembered code.
2. A remembered code in `localStorage`, if it is less than 30 days old.
3. Nothing: show only the **Have a referral code?** link.

### 5.2 Remembering the code for 30 days

| Item | Value |
| --- | --- |
| Storage | `localStorage` |
| Key | `jx_referral` |
| Value | `{"code":"SFY-7K2Q","savedAt":1760262000000}` |
| Saved when | A page is opened with `?ref=` |
| Used when | Signup page opens without `?ref=` and `Date.now() - savedAt < 30 days` |
| Cleared when | Signup succeeds, the customer removes the code, or the entry is older than 30 days |
| Not saved | Codes typed by hand |

Wrap every `localStorage` read and write in `try/catch`. In private mode or with blocked storage the link code still works for that visit; only the 30-day memory is lost.

### 5.3 When to call U1

- On page open, if a code came from 5.1 (1) or (2): call immediately.
- While typing: wait 400 ms after the last keystroke; call only if the trimmed value has 6 or more characters.
- On leaving the field: call if not already checked.
- Ignore stale responses: give each call an increasing request number and apply a response only if it belongs to the latest call.
- Upper-case the input as the customer types.

### 5.4 Field states

| State | Trigger | Shows | Sign Up |
| --- | --- | --- | --- |
| Hidden | No code from link or memory | Only the **Have a referral code?** link | Allowed |
| Empty | Field opened, nothing typed | Empty field, "(optional)" label | Allowed |
| Too short | 1–5 characters | No message | Blocked until fixed or removed |
| Checking | U1 in flight | Spinner, "Checking…" | Waits for the result |
| Valid | `VALID` | Green border, "✓ Referral code applied" | Allowed, code sent |
| Invalid | `INVALID` | Red border, "This code isn't valid." + **Remove code** | Blocked |
| Inactive | `INACTIVE` | Red border, "This code is no longer active." + **Remove code** | Blocked |
| Check failed | `429` or network error | "We couldn't check this code right now." | Allowed; the server checks again |

**Remove code** (and the × in the field) clears the input, clears the state, removes `jx_referral`, and keeps the field open.

### 5.5 What goes in the register payload

| Field state at submit | Payload |
| --- | --- |
| Hidden or empty | `referralCode` not sent |
| Valid | `referralCode: "SFY-7K2Q"` |
| Check failed | `referralCode` sent; the server decides |
| Invalid / Inactive / Too short | Submit blocked; customer fixes or removes the code |

After a successful signup, remove `jx_referral`.

---

## 6. Test cases

### Backend

| # | Case | Expected |
| --- | --- | --- |
| B1 | U1 with an active code | `200 {"status":"VALID"}` |
| B2 | U1 with lower-case active code | `VALID` |
| B3 | U1 with a deactivated or refreshed code | `INACTIVE` |
| B4 | U1 with an unknown code | `INVALID` |
| B5 | U1 with `ab` or `SFY_7K2Q` | `INVALID`, no DB query |
| B6 | U1 called 31 times in a minute from one IP | 31st returns `429 RATE_LIMITED` |
| B7 | U1 response body | Contains only `status`; no owner data |
| B8 | Register without `referralCode` | Success; `tenant_referrals` row with `code_id` null |
| B9 | Register with an active code | Success; row with that `code_id`, `source = SIGNUP` |
| B10 | Register with unknown or inactive code | Success; `code_id` null; warning logged |
| B11 | Register with `referralCode: 123` or a 500-char string | Success; treated as absent |
| B12 | Register where the referral insert is forced to fail | Success; tenant and user created; no referral row |
| B13 | Register that fails for an existing reason (email taken) | Same error as today; no `tenant_referrals` row |

### Frontend

| # | Case | Expected |
| --- | --- | --- |
| F1 | Open `#/signup` | Only the **Have a referral code?** link |
| F2 | Open `#/signup?ref=SFY-7K2Q` | Field open, filled, "Referral code applied" |
| F3 | Open link, close tab, return to `#/signup` within 30 days | Code filled and applied automatically |
| F4 | Same as F3 after 31 days | No code |
| F5 | Open link A, then link B | Link B's code is used |
| F6 | Type a code quickly | One U1 call after typing stops; no flicker from older responses |
| F7 | Invalid code, click Sign Up | Submit blocked; Remove code works in one click |
| F8 | Remove code, then Sign Up | Signup succeeds as Direct; `jx_referral` cleared |
| F9 | Successful signup with a code | `jx_referral` cleared |
| F10 | Private mode, open link | Code works for that visit; no errors in console |
| F11 | Phone width | Field, messages and Remove code fit without horizontal scroll |

---

## 7. Open points

- [ ] **Framework:** examples assume Express (`express-rate-limit`). On Fastify, use `@fastify/rate-limit` with the same settings.
- [ ] **Trust proxy:** confirm the gateway/load-balancer setup so `req.ip` is the real client IP; otherwise every request shares one limit.
- [ ] **Migration order:** U2 writes to `tenant_referrals`, so the admin-side migration must be deployed before (or with) this change.
- [ ] **Register field names:** the example body uses assumed names for existing fields; only `referralCode` is new.
- [ ] **Release order:** backend first. The new field is optional, so the current frontend keeps working with the new backend.

## Implementation notes (authservice, 2026-10-12)

- Public status check: `GET /api/public/referrals/{code}/status` on authservice (rate-limited, 30 per IP per minute).
  Earlier alias `GET /api/auth/referral-codes/{code}/status` still answers `{ "status": "VALID" | "INVALID" | "INACTIVE" }`.
- Firm registration (`POST /api/auth/register/firm`) writes the `tenant_referrals` row inside the same transaction as the firm.
- Solo registration (`POST /api/auth/register/solo`), the legacy `POST /api/auth/register` and new Google sign-ups have no firm,
  so they write the same row to `user_referrals` (created by authservice at startup, keyed on `users.id`):

  ```sql
  CREATE TABLE IF NOT EXISTS user_referrals (
    user_id      integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_id      uuid NULL REFERENCES referral_codes(id),
    source       varchar(10) NOT NULL DEFAULT 'SIGNUP' CHECK (source IN ('SIGNUP', 'ADMIN')),
    signed_up_at timestamptz NOT NULL DEFAULT now(),
    set_by       integer NULL,
    set_at       timestamptz NULL,
    reason       varchar(500) NULL
  );
  ```

  The super-admin reports currently read only `tenant_referrals`; to count solo sign-ups they must also read `user_referrals`
  (UNION on `code_id`, `source`, `signed_up_at`).
- Register responses carry `"referral": { "code": "<CODE>" | null, "status": "ATTACHED" | "DIRECT" | "INACTIVE" | "NOT_FOUND" | "INVALID_FORMAT" }`.
- Frontend keeps the `?ref=` code in `localStorage` (30 days) and `sessionStorage` (this tab, survives OTP steps) under `jx_referral`.
