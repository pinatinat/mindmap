# OmniMind

Browser mind map. OmniMind Pro is a one-time **$9** purchase through PayPal Checkout (sandbox first). There is no subscription.

`index.html` and `MINDMAP.html` are the same app and must stay identical.

## Environment variables

Set these on Vercel (Production and Preview). Do not commit secrets.

| Variable | Purpose |
| --- | --- |
| `PAYPAL_CLIENT_ID` | PayPal REST app client id. Sandbox and live ids differ. |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app secret. Server only. |
| `PAYPAL_WEBHOOK_ID` | Id of the webhook that listens for `PAYMENT.CAPTURE.COMPLETED`. |
| `PAYPAL_ENV` | `sandbox` or `live`. Defaults to `sandbox`. |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON, as a single string. |
| `RESEND_API_KEY` | Resend API key used to email the Pro code. |

The page embeds the public sandbox client id so the PayPal button can load. That id is not a secret:

`AfLUWmx3V0glGmHJI9Lwq2vSeYMP4HWrdlrjnmx9UPtK7ssmgO8AldGDFOr5KrX17Usx8W_gyl9v6lT8`

`PAYPAL_CLIENT_ID` on the server should be the same sandbox id while `PAYPAL_ENV=sandbox`. Never put `PAYPAL_CLIENT_SECRET` in the repo, the HTML, or a `NEXT_PUBLIC_` / `VITE_` variable.

## PayPal sandbox

1. In the PayPal developer dashboard, open the sandbox app and copy the client id and secret into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. Set `PAYPAL_ENV=sandbox`.
3. Add a webhook for `https://<your-domain>/api/paypal/webhook` subscribed to `PAYMENT.CAPTURE.COMPLETED`. Copy its webhook id into `PAYPAL_WEBHOOK_ID`.
4. Checkout calls `POST /api/paypal/create-order` and `POST /api/paypal/capture-order`. The server creates a $9.00 USD order and captures it. The browser cannot choose the amount.
5. The webhook verifies the PayPal signature, then issues the same code for that capture id. Repeating the capture or the webhook does not mint a second code or send a second email.

## Firebase

1. Firebase project `omnimindmap` (or the project in the page config).
2. Download a service account JSON and set `FIREBASE_SERVICE_ACCOUNT` to the raw JSON string.
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`). Clients cannot read or write `pro_codes` or `pro_captures`. The Admin SDK bypasses those rules.
4. Map documents under `users/{uid}/maps` stay readable and writable by any signed-in user, including anonymous guests, so share links and live collaboration keep working. User profile updates cannot change `plan`, `maxMaps`, or `codeUsed`.

## Email

Resend sends from `OmniMind <support@omnimindmap.app>`. Verify the `omnimindmap.app` domain in Resend before live mail will deliver. If `RESEND_API_KEY` is missing, the code is still stored and the capture response includes it so a sandbox payment is not lost.

## Activate in the app

The buyer enters the PayPal email and the code. `POST /api/pro/activate` checks both and records the device. A code allows about 3 devices. The same device can activate again. A fourth distinct device is rejected. The browser stores a local verified flag and `isPro()` follows that flag. The client does not write the code to Firestore.

## Legal

Footer links:

- `/legal/terms.html`
- `/legal/privacy.html`
- `/legal/refund.html`
- `support@omnimindmap.app`

## Tests

```bash
node --test tests/
```

`firebase-admin` is a runtime dependency for the Vercel functions. The tests inject an in-memory database and do not need the service account.
