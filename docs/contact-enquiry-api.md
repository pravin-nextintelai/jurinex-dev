# Contact Enquiry API (authservice)

Backend for the landing page **"Contact Jurinex"** form. Stores each submission in
`contact_enquiries` (+ a `submitted` row in `contact_enquiry_activities`) for the
marketing admin dashboard. Public endpoint — no login, no token.

| | |
|---|---|
| **Method / path** | `POST /api/auth/contact-enquiries` |
| **Via gateway (frontend)** | `POST {VITE_APP_GATEWAY_URL}/api/auth/contact-enquiries` (local: `http://localhost:5000/api/auth/contact-enquiries`) |
| **Direct (authservice)** | `http://localhost:5001/api/auth/contact-enquiries` |
| **Content-Type** | `application/json` |
| **Auth** | none |

Code: `Backend/authservice/src/routes/contactEnquiryRoutes.js` → `controllers/contactEnquiryController.js` → `models/ContactEnquiry.js`.
Schema is ensured at boot by `utils/contactEnquiryDb.js` (runs `models/migrations/create_contact_enquiries_tables.sql`, idempotent).

---

## Request body

| Field | Form label | Required | Rules |
|---|---|---|---|
| `first_name` | Name | ✅ | 1–100 chars. Alias: `name` |
| `last_name` | Surname | ✅ | 1–100 chars. Alias: `surname` |
| `email` | Email | ✅ | valid email, ≤255, stored lower-case |
| `mobile_number` | Mobile number | ✅ | 8–15 digits; spaces/dashes/brackets stripped. Aliases: `mobile`, `phone` |
| `country_code` | (dial-code picker) | – | e.g. `"+91"`. Prefixed when `mobile_number` has no leading `+` (leading zeros dropped) |
| `organisation_name` | Organisation name | – | ≤255. Aliases: `organization_name`, `organisation` |
| `topic` | What is this about? | – | one of the slugs below |
| `message` | Additional details | – | ≤5000 chars. Alias: `additional_details` |
| `marketing_consent` | consent checkbox | – | boolean (`true`/`"true"`/`1`/`"on"`). Sets `consent_given_at = NOW()` when true. Alias: `consent` |
| `page_url` | – | – | page the form was on (falls back to `Referer`) |
| `source` | – | – | defaults to `website_contact_form` |
| `website` | hidden honeypot | – | **must stay empty** — any value → fake success, nothing stored |

Captured server-side: `ip_address` (first `X-Forwarded-For` hop), `user_agent`, `created_at` (UTC).

### Topic slugs (`topic`)

| slug | dropdown label |
|---|---|
| `demo` | Request a demo / walkthrough |
| `pricing` | Pricing & plans |
| `onboarding` | Onboarding & training |
| `data_security` | Data security & compliance |
| `partnership` | Partnership / enterprise |
| `support` | Existing customer support |
| `other` | Something else |

Slugs are matched case-insensitively; spaces/hyphens are normalised to `_`. Unknown values → `400`.
(Labels live in `TOPICS` in `contactEnquiryController.js` — change the dropdown there.)

### Example

```json
POST /api/auth/contact-enquiries
{
  "first_name": "Priya",
  "last_name": "Sharma",
  "email": "priya.sharma@example.com",
  "country_code": "+91",
  "mobile_number": "98765 43210",
  "organisation_name": "Sharma & Associates",
  "topic": "pricing",
  "message": "We are a 6-lawyer firm, need pricing for a team plan.",
  "marketing_consent": true,
  "page_url": "https://jurinex.ai/contact",
  "website": ""
}
```

```bash
curl -X POST http://localhost:5000/api/auth/contact-enquiries \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Priya","last_name":"Sharma","email":"priya.sharma@example.com","country_code":"+91","mobile_number":"98765 43210","organisation_name":"Sharma & Associates","topic":"pricing","message":"Need team pricing.","marketing_consent":true,"page_url":"https://jurinex.ai/contact"}'
```

---

## Responses

### `201 Created` — stored

```json
{
  "success": true,
  "message": "Thanks, Priya. Your enquiry has been received — a member of the Jurinex team will reply within one working day.",
  "enquiry": {
    "id": 5,
    "reference_no": "CE-20260911-00001",
    "status": "new",
    "topic": "pricing",
    "topic_label": "Pricing & plans",
    "marketing_consent": true,
    "submitted_at": "2026-09-11T05:53:22.286Z",
    "submitted_at_ist": "11 Sep 2026, 11:23 AM IST"
  }
}
```

* `reference_no` = `CE-<IST date>-<5-digit daily counter>`; counter restarts each IST day. Show it to the visitor.
* `submitted_at` is UTC ISO-8601 (what the DB stores); `submitted_at_ist` is the display string.

### `200 OK` — duplicate (same email + mobile + message within 10 min)

Double-clicks / retries return the original enquiry instead of creating a second lead.

```json
{
  "success": true,
  "duplicate": true,
  "message": "We already have your enquiry (CE-20260911-00001). No need to resend — our team will be in touch.",
  "enquiry": { "...same shape as 201..." }
}
```

### `400 Bad Request` — validation

`errors` is keyed by field name so the form can highlight inputs.

```json
{
  "success": false,
  "message": "Please fix the highlighted fields.",
  "errors": {
    "first_name": "Name is required",
    "last_name": "Surname is required",
    "email": "Enter a valid email address",
    "mobile_number": "Enter a valid mobile number (8–15 digits)",
    "topic": "Unknown topic. Allowed: demo, pricing, onboarding, data_security, partnership, support, other"
  }
}
```

### `429 Too Many Requests` — more than 5 submissions from one IP in 15 min

```json
{
  "success": false,
  "message": "Too many enquiries from this connection. Please try again in a few minutes.",
  "retry_after_seconds": 842
}
```
(`Retry-After` header is also set.)

### `500 Internal Server Error`

```json
{ "success": false, "message": "We could not save your enquiry right now. Please try again or email connect@jurinex.ai." }
```

---

## What gets written

**`contact_enquiries`** — one row: form fields + `source`, `page_url`, `ip_address`, `user_agent`,
`status='new'`, `priority='normal'`, `status_changed_at=NOW()`, `consent_given_at` (if consented), `created_at` (UTC).

**`contact_enquiry_activities`** — one row: `activity_type='submitted'`, `to_value='new'`,
`actor_role='visitor'`, `actor_email=<visitor email>`, `occurred_at=<created_at>`,
`note="Enquiry submitted via website_contact_form (topic: pricing) — marketing consent given"`.

All marketing-workflow columns (`assigned_to`, `first_contacted_at`, `contact_attempts`, …) are left for the
admin endpoints to fill in.

---

## Frontend snippet

```js
const res = await fetch(`${GATEWAY_URL}/api/auth/contact-enquiries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...form, page_url: window.location.href, website: '' }),
});
const data = await res.json();
if (res.status === 400) setFieldErrors(data.errors);
else if (data.success) showThanks(data.enquiry?.reference_no, data.message);
```
