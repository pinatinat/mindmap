# 💳 PayMongo Lifetime Pro Integration Guide

This guide explains how to connect your approved **PayMongo** merchant account to OmniMind to accept GCash, Maya, ShopeePay, and Credit/Debit cards for the **₱299 Lifetime Pro** upgrade.

---

## 1. Quick Setup: Create a Payment Link (2 Minutes)

Once PayMongo approves your account:

1. Log into your [PayMongo Dashboard](https://dashboard.paymongo.com/).
2. Navigate to **Links** (in the left sidebar) and click **Create Link**.
3. Fill in the details:
   - **Amount:** `PHP 299.00`
   - **Description:** `OmniMind Lifetime Pro (50 Cloud Mind Maps + Real-time Sync)`
   - **Payment Methods:** Turn ON **GCash**, **Maya**, **Cards**, **ShopeePay**.
   - **Customer Fields:** Require **Email** and **Name**.
4. Click **Create Link**.
5. Copy your link (it looks like `https://paymongo.page/l/your-custom-link` or `https://pm.link/...`).
6. In `MINDMAP.html` and `index.html`, update the constant near line 2130:
   ```javascript
   const PAYMONGO_PRO_PAYMENT_LINK = 'https://paymongo.page/l/your-custom-link';
   ```

---

## 2. Automatic Upgrades via Webhook (Vercel)

OmniMind includes a ready-to-deploy serverless endpoint:
`/api/paymongo-webhook`

### How to configure in PayMongo:
1. In your PayMongo Dashboard, go to **Developers** -> **Webhooks**.
2. Click **Add Webhook**.
3. Enter your Webhook URL:
   ```
   https://<your-vercel-domain>.vercel.app/api/paymongo-webhook
   ```
4. Select the following events:
   - `link.payment.paid`
   - `payment.paid`
   - `checkout_session.payment.paid`
5. Click **Create**.
6. PayMongo will show you your **Webhook Signing Secret** (starts with `whsec_...`).
7. In your [Vercel Project Dashboard](https://vercel.com/) -> **Settings** -> **Environment Variables**, add:
   - `PAYMONGO_WEBHOOK_SECRET`: your `whsec_...` secret.

---

## 3. Immediate Pro Activation Without Waiting for Webhooks

You have 2 built-in instant methods to upgrade any user right now:

### Method A: In-Code Whitelist
Open `MINDMAP.html` and `index.html` and add their Firebase UID or email to `UPGRADED_ACCOUNTS`:
```javascript
const UPGRADED_ACCOUNTS = {
    'ADMIN_FIREBASE_UID_HERE': 50, // Optional admin whitelist
    'friend@gmail.com': 50,
};
```

### Method B: Activation Code
In the Upgrade Modal, clicking **"Have an activation code or paid manually?"** opens a code prompt.
Entering the master admin code:
```
OMNIPRO50
```
Instantly activates Lifetime Pro (50 Cloud Slots) and persists it locally and in Firestore!

