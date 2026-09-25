# Migrating to the payment ledger

Move a Goovee deployment onto the payment ledger: every payment is a record in
the back office from the moment the buyer presses a payment button, the
provider's events are kept against it, and the ERP books it from that record.
Follow this runbook when upgrading:

- **2.3.x or earlier → 2.4.0 or later**

It needs the axelor-portal module that the release compatibility matrix pairs
with this release. Perform the steps in order, per tenant where a step says so.
Steps 1 to 4 come before the new portal serves traffic; step 7 is optional and
comes last.
[CONFIGURATION.md](../CONFIGURATION.md) describes every setting written here.

---

## 1. Settle the payments still in flight

The previous release tracked a payment in progress as a payment context. This
release completes none of them: the addresses the previous release gave its
payments, under `/<tenant>/api/payment/`, are gone, a buyer returning from one
is not recorded, and a provider's notification for one is refused. While the previous release is still running, run this against each
tenant's database:

```sql
SELECT
  id,
  status,
  created_on
FROM
  portal_payment_context
WHERE
  status = 'pending';
```

The upgrade may go ahead once it returns no rows. For each row it returns, look
the payment up at its provider, and either let it finish on the previous
release or settle it by hand in the ERP before upgrading. Start with HUB PISP
rows: a HUB PISP transfer can stay pending for a day, and on the previous
release only its startup resumed it.

A Stripe bank transfer can stay pending for weeks, since the payer sends it when
they choose. Settling one by hand means cancelling its payment intent in the
Stripe dashboard before the upgrade, whether or not the invoice is paid another
way: a payer who wired later would otherwise be charged, with nothing recording
the payment in the ERP.

These payments are not moved into the new payment records: a payment context
holds the provider, the payer and the priced purchase, but neither the amount
taken nor, for most providers, the provider's own reference, and the ERP already
holds what each finished payment booked.

## 2. Check the currencies

A payment is refused before it starts when the ERP gives its currency a number
of decimals other than the ISO one: every provider counts in the ISO unit, and
the ledger counts an event only at the payment's own scale. Most currencies
have 2 decimals; JPY, XOF and others have 0; BHD, KWD, TND and a few others
have 3. Run this per tenant and correct any currency the tenant takes payments
in:

```sql
SELECT
  codeiso,
  number_of_decimals
FROM
  base_currency
ORDER BY
  codeiso;
```

## 3. Migrate each tenant's schema

Stop the previous portal first. Its checkouts book their payments through AOS
endpoints this release removes — `ws/portal/orders/order`,
`ws/portal/marketplace/order`, `ws/portal/invoice/payment` and
`ws/portal/invoice/eventInvoice` — so a payment taken between the AOS upgrade and
the portal's would be charged and never booked.

AOS runs no DDL on a named tenant: schema updates and module loading at startup
reach the default database only. So bring each tenant's database up to date by
booting AOS once with that database as its default connection.
`AXELOR_CONFIG_<KEY>` sets a setting with `_` read as `.`, so no configuration
file changes:

```
AXELOR_CONFIG_DB_DEFAULT_URL=jdbc:postgresql://db.example.com:5432/acme \
  <the usual AOS start command>
```

Wait for `Ready to serve`, stop it, and repeat for the next tenant; then start
AOS normally, which does the same for the default database. Leave
`application.multi-tenancy` as it is: only the default connection is used at
startup. Each boot creates the tables below and loads the new views, selections
and menus. Do it before the new portal is deployed: the portal writes these
tables from its first payment.

The tables the module adds:

- `portal_portal_payment` — one row per payment. Its subject is a model and a
  record id, `subject_model` and `subject_id`, with `exclusive_subject_id` set
  for a subject that carries one payment only. It has a unique constraint on
  `(subject_model, exclusive_subject_id)`, an index on
  `(subject_model, subject_id)`, and unique `reference` and `submit_token`.
- `portal_portal_payment_session` — one row per attempt at a provider, with the
  `amount`, `currency_code` and `currency_scale` it asked for, unique on
  `(gateway, session_ref)`. A tenant that ran a pre-release build may hold two
  sessions naming the same provider session, and AOS then skips the key without
  saying so. Check before the upgrade — this lists
  none on a clean database:

  ```sql
  SELECT
    gateway,
    session_ref,
    count(*)
  FROM
    portal_portal_payment_session
  WHERE
    session_ref IS NOT NULL
  GROUP BY
    1,
    2
  HAVING
    count(*) > 1;
  ```

  Each pair it lists is one provider session recorded twice; keep the row the
  payment's events name and clear `session_ref` on the other.

- `portal_portal_payment_event` — the ledger, unique on `(gateway, event_key)`,
  with `currency_scale`.
- `portal_portal_payment_job` — outstanding work, unique on `(payment, kind)`.
- `portal_portal_payment_recorded_event` — events entered by hand in the ERP,
  unique on `event_key`.
- `portal_portal_order_request` and `portal_portal_order_request_line` — the
  shop purchases the ERP builds its sale orders from.

No existing table gains a column. The portal creates one table of its own,
`portal_payment_intent`, when it starts. Two things the previous release wrote
are left as they are, unused: the `portal_payment_context` table, which step 1
reads, and the `payment_context_id` column of `portal_marketplace_product_order`,
which a 2.3.x database carries. Step 7 says when they can go.

Then check each tenant:

```sql
SELECT
  count(*)
FROM
  information_schema.tables
WHERE
  table_schema = current_schema()
  AND table_name IN (
    'portal_portal_payment',
    'portal_portal_payment_session',
    'portal_portal_payment_event',
    'portal_portal_payment_job',
    'portal_portal_payment_recorded_event',
    'portal_portal_order_request',
    'portal_portal_order_request_line'
  );
```

It returns 7.

A tenant whose views were not reloaded — the selections of the payment form
missing, or the _Portal › Payments_ menu absent — restores them instead, with
`Administration › Views › Restore all` signed in to that tenant, or headlessly,
sending the tenant's id on both calls:

```bash
BASE=https://erp.example.com/axelor-erp
TENANT=acme

curl -s -c /tmp/aos.txt -H 'Content-Type: application/json' -H "X-Tenant-ID: $TENANT" \
  -d '{"username":"admin","password":"…"}' $BASE/callback

CSRF=$(grep CSRF-TOKEN /tmp/aos.txt | awk '{print $NF}')

curl -s -b /tmp/aos.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -H "X-Tenant-ID: $TENANT" \
  -d '{"model":"com.axelor.meta.db.MetaView","action":"action-meta-restore-all","data":{"context":{}}}' \
  $BASE/ws/action/action-meta-restore-all
```

Restoring discards view customizations.

### A database that ran a pre-release build

A database that ran a build of this change before its release may still carry a
payment's subject in four columns this release no longer has. A database
upgraded from 2.3.x never had them; check first:

```sql
SELECT
  column_name
FROM
  information_schema.columns
WHERE
  table_name = 'portal_portal_payment'
  AND column_name IN (
    'invoice',
    'registration',
    'marketplace_product_order',
    'shop_order_request'
  );
```

With no rows, skip to step 4. With rows, move the subjects onto the new columns
and drop the old ones, after the boot above has created the new columns:

```sql
BEGIN;

UPDATE portal_portal_payment
SET
  subject_model = CASE
    WHEN invoice IS NOT NULL THEN 'com.axelor.apps.account.db.Invoice'
    WHEN registration IS NOT NULL THEN 'com.axelor.apps.portal.db.Registration'
    WHEN marketplace_product_order IS NOT NULL THEN 'com.axelor.apps.portal.db.MarketplaceProductOrder'
    WHEN shop_order_request IS NOT NULL THEN 'com.axelor.apps.portal.db.PortalOrderRequest'
  END,
  subject_id = COALESCE(
    invoice,
    registration,
    marketplace_product_order,
    shop_order_request
  ),
  exclusive_subject_id = CASE
    WHEN invoice IS NULL THEN COALESCE(
      registration,
      marketplace_product_order,
      shop_order_request
    )
  END,
  projected_invoice = CASE
    WHEN source = 'invoices'
    AND projected_invoice_payment IS NOT NULL THEN COALESCE(projected_invoice, invoice)
    ELSE projected_invoice
  END,
  version = version + 1,
  updated_on = now()
WHERE
  subject_id IS NULL
  AND COALESCE(
    invoice,
    registration,
    marketplace_product_order,
    shop_order_request
  ) IS NOT NULL;

ALTER TABLE portal_portal_payment
DROP COLUMN invoice,
DROP COLUMN registration,
DROP COLUMN marketplace_product_order,
DROP COLUMN shop_order_request;

COMMIT;
```

A unique-constraint error on the update means two payments name the same
registration, marketplace order or order request; resolve the pair by hand
before running it again.

A pre-release database also keeps what earlier builds tracked about refunds,
disputes and provider events that named no payment, and the by-hand fields of
the payment. Nothing reads them, and every column is nullable, so they can stay.
To remove them:

```sql
DROP TABLE IF EXISTS portal_portal_payment_finance_item;

ALTER TABLE portal_portal_payment_recorded_event
DROP COLUMN IF EXISTS unmatched_event,
DROP COLUMN IF EXISTS deadline;

DROP TABLE IF EXISTS portal_portal_payment_unmatched_event;

DROP TABLE IF EXISTS portal_portal_payment_correlation_ref;

ALTER TABLE portal_portal_payment_event
DROP COLUMN IF EXISTS deadline;

ALTER TABLE portal_portal_payment
DROP COLUMN IF EXISTS refunded_amount,
DROP COLUMN IF EXISTS delivered_by_hand_by,
DROP COLUMN IF EXISTS delivered_by_hand_on,
DROP COLUMN IF EXISTS booked_by_hand_by,
DROP COLUMN IF EXISTS booked_by_hand_on;
```

A payment an earlier build left as refunded or charged back keeps that status,
which the ERP no longer lists, until an event comes for it. Its captured amount
is what its captures add up to, refunds never taken off, so the status the
ledger gives it now follows from that amount alone. Once, per tenant:

```sql
UPDATE portal_portal_payment
SET
  status = CASE
    WHEN captured_amount >= amount
    AND amount > 0 THEN 'captured'
    WHEN captured_amount > 0 THEN 'partially_captured'
    ELSE status
  END,
  version = COALESCE(version, 0) + 1,
  updated_on = now()
WHERE
  status IN ('refunded', 'charged_back');
```

A row with nothing captured keeps its status; look it up at the provider.

An earlier build marked a bank transfer funded in part as captured, so the
portal no longer follows it to the end of its 14 days. Put such sessions back
to awaiting, once, per tenant:

```sql
UPDATE portal_portal_payment_session AS session
SET
  status = 'awaiting',
  version = COALESCE(session.version, 0) + 1,
  updated_on = now()
WHERE
  session.status = 'captured'
  AND session.gateway = 'stripe_bank_transfer'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      portal_portal_payment_event AS event
    WHERE
      event.session = session.id
      AND event.type <> 'partially_captured'
  )
  AND EXISTS (
    SELECT
      1
    FROM
      portal_portal_payment_event AS event
    WHERE
      event.session = session.id
      AND event.type = 'partially_captured'
  );
```

An earlier build also handed a payment its reconcile job could not settle to a
person, parking the job. The job now closes such a session itself, as
unconfirmed or cancelled at the provider. Put the parked jobs back on the queue,
once, per tenant:

```sql
UPDATE portal_portal_payment_job
SET
  classification = NULL,
  last_error = NULL,
  attempts = 0,
  next_attempt_on = now(),
  version = COALESCE(version, 0) + 1,
  updated_on = now()
WHERE
  kind = 'reconcile'
  AND classification = 'needs_decision';
```

Restoring the views does not remove what earlier builds loaded: the _To book in
the ERP_, _Unmatched events_ and _Unconfirmed_ menus stay under _Portal ›
Payments_, the first two opening views of models that are gone and the last a
list _All payments_ now has as its _No answer from the provider_ filter. Delete
the three menus in _Administration › Menus_, or per tenant, with the groups and
roles that point at them, and the actions they opened:

```sql
BEGIN;

DELETE FROM meta_menu_groups
WHERE
  meta_menu_id IN (
    SELECT
      id
    FROM
      meta_menu
    WHERE
      name IN (
        'menu-portal-payment-finance',
        'menu-portal-payment-unmatched',
        'menu-portal-payment-unconfirmed'
      )
  );

DELETE FROM meta_menu_roles
WHERE
  menus IN (
    SELECT
      id
    FROM
      meta_menu
    WHERE
      name IN (
        'menu-portal-payment-finance',
        'menu-portal-payment-unmatched',
        'menu-portal-payment-unconfirmed'
      )
  );

DELETE FROM meta_menu
WHERE
  name IN (
    'menu-portal-payment-finance',
    'menu-portal-payment-unmatched',
    'menu-portal-payment-unconfirmed'
  );

DELETE FROM meta_action
WHERE
  name IN (
    'action.portal.payment.finance.open',
    'action.portal.payment.unmatched',
    'action.portal.payment.unconfirmed'
  );

COMMIT;
```

## 4. Configure AOS

- **Permission.** The AOS user the portal authenticates as needs WRITE on
  _Portal payment_ (`PortalPayment`): the portal asks AOS to book a captured
  payment through `ws/portal/payments/drain`, which checks it.
- **No scheduler.** `quartz.enable` is not needed. The portal asks AOS to book
  each payment as it is captured; one that could not be booked then — AOS
  unreachable, a configuration to fix — waits under _Payments to resolve_ for
  _Register payment_, as does any booking that needs a person's decision.
- **One time zone.** Run the AOS JVM, the database and the portal in the same
  zone, for example UTC: `-Duser.timezone=UTC` on the JVM,
  `ALTER ROLE <role> SET timezone = 'UTC'` on the database role (or the
  database), and `TZ=UTC` on the portal's host. Payment jobs record their times
  without a zone, and each side compares them with the database's clock; with
  the zones apart, jobs fall due, escalate and are reconciled late or early by
  exactly the difference.

## 5. Register the providers

Each provider's notification address is the tenant's own
`/<tenant>/api/webhooks/<provider>`, in the routing and base-path form the
deployment uses; CONFIGURATION.md §7.4 writes out the combinations. Register it
per tenant, with that tenant's own merchant account.

### Stripe

Add a webhook endpoint at `/<tenant>/api/webhooks/stripe` and subscribe it to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.partially_funded`
- `payment_intent.canceled`

Put its signing secret in `PORTAL_TENANT_<ID>_PAYMENTS_STRIPE_WEBHOOK_SECRET`.
Without it the webhook is refused and bank transfer is not offered.
`PORTAL_TENANT_<ID>_PAYMENTS_STRIPE_BANK_TRANSFER_COUNTRY` names, as two
letters, the country whose bank account Stripe presents for EUR bank transfers;
it defaults to `FR`.

### PayPal

Register a webhook for the tenant's PayPal app at `/<tenant>/api/webhooks/paypal`,
subscribed to:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`

Put the webhook's id in `PORTAL_TENANT_<ID>_PAYMENTS_PAYPAL_WEBHOOK_ID`. PayPal
signs each notification and the portal checks the signature against this id;
without it, PayPal's notifications are refused and a payment is recorded only
when the buyer comes back to the site.

### Paybox and Up2Pay

Deploy Verifone's public key for each gateway at `certs/paybox/public-key.pem`
and `certs/up2pay/public-key.pem`, under the directory the portal is started
from, and use the key of the environment the merchant account belongs to. Every
notification's signature is checked against it.

Paybox needs no address registered: the portal sends
`/<tenant>/api/webhooks/paybox` with each payment. Register
`/<tenant>/api/webhooks/up2pay` with Up2Pay.

### HUB PISP

Register `/<tenant>/api/webhooks/hubpisp/<resourceId>` with the bank, as
CONFIGURATION.md §9.5 describes, and deploy the tenant's `client.crt` and
`private-key.pem` in its `PORTAL_TENANT_<ID>_PAYMENTS_HUBPISP_CERTS_DIR`.

## 6. Deploy the portal and verify

Deploy the new portal. Then, per tenant:

1. Pay an invoice by card. The result page at
   `/<tenant>/<workspace>/payments/<reference>` reads paid, and the payment is under _Portal › Payments › All payments_ in
   the ERP with its ERP invoice payment linked.
2. In the provider's dashboard, the webhook delivery for that payment succeeded.
   From then on, _Technical › Missed webhooks_ in the ERP lists, per
   provider, the captures a webhook left unconfirmed.

A payer who presses a payment button on a page loaded before the deploy starts
a new payment rather than resuming the one begun there; the earlier one's
provider session, if still open, expires on its own, and an invoice's open
transfer is withdrawn once the invoice is paid.

## 7. Remove the previous release's payment records (optional)

Once every tenant runs this release, nothing reads `portal_payment_context` or
`portal_marketplace_product_order.payment_context_id`. The table holds what the
previous release recorded about each payment it took — the provider, the payer
and the priced purchase — so keep it while finance may need to trace one of
those. To remove both, per tenant:

```sql
ALTER TABLE portal_marketplace_product_order
DROP COLUMN IF EXISTS payment_context_id;

DROP TABLE IF EXISTS portal_payment_context;
```

---

## Running payments

What the ERP's _Portal › Payments_ menu shows, and what finance does with it.

- _Payments to resolve_ — a payment whose delivery failed, one more captured than
  it was for, or one whose booking in the ERP needs a decision or still fails
  past its time.
  Settle it outside the portal, then press _Resolve_ on the payment with what
  was done: the purchase honoured another way, the excess given back at the
  provider, the booking made in the ERP by hand. The payment then stops
  waiting; the reason, who and when are kept on it.
- _All payments_ — every payment, with filters by status and by app. Its _No
  answer from the provider_ filter lists the payments whose provider never
  answered. The portal asks a provider that can be asked daily past the
  session's deadline, and closes the session with no answer 30 days past it; it
  closes one at once when the provider no longer holds it, names another
  payment, or was never given the provider's handle. The session's failure
  reason says which, and what to look up at the provider.
- _Technical_:
  - _Missed webhooks_ — captures the provider's webhook never confirmed,
    grouped by provider.
  - _Pending tasks_ — every payment job by kind, opened on the overdue ones,
    including the provider checks still waiting on an answer.
  - _Payment attempts_, _Provider notifications_ and _Manual entries_ — every
    payment's attempts at the provider, what the provider reported, and what a
    person entered from a back office.
- _Configuration › Payment methods_ — the payment methods a workspace offers,
  formerly _Portal › Configuration › Payment config_.

### Refunds and disputes

The portal does not track them. A refund is made, and a dispute answered, at
the provider, from its dashboard or back office; finance books the ERP side by
hand, as for any payment. Neither changes what the portal delivered.

Reverse a refunded invoice payment in the ERP promptly: until then the portal
reads the invoice as paid, refusing a new payment of it and withdrawing a bank
transfer the payer started on it.

### More captured than the payment was for

Two sessions of one payment can both take the money, a payer who paid by card
and by transfer for instance. The payment is booked in the ERP for the amount
it was for, at most, shows the excess on its form, and waits under _Needs
attention_: give the excess back at the provider, then _Resolve_ the payment.
Its booking, if still to run, runs as usual.

### A Paybox or Up2Pay notification that never came

Verifone does not retry a failed notification. If the portal is down when a
payer validates and the payer does not return to the result page, a payment
really made ends up with no answer from the provider a week later, its invoice or order still
unpaid, and the payer may pay again.

- Verifone mails "PAYBOX: WARNING!!" to the merchant address it holds whenever a
  notification fails. On receiving one, find the payment by its `GVP-` reference
  in the Paybox or Up2Pay back office and, if it was paid, record it on the
  payment in the ERP with _Record payment received_. It is then
  settled as the notification would have settled it.
- Check _All payments_ filtered on _No answer from the provider_ against the
  provider's back office weekly, for example
  every Monday, which covers the week a payment waits before it lands there.
- A payer who paid twice has one payment refunded at the provider, and the ERP
  side booked by hand.

### After changing PayPal credentials

PayPal answers "no such order" for every order when the credentials point at
another account or environment — live and sandbox swapped, an app rotated. Every
open PayPal payment is then closed with no answer on its next check. Nothing is
lost, but check _No answer from the provider_ under _All payments_ for a burst
after changing them.

### Confirmations sent twice

The portal always confirms a payment to the payer. The ERP sends its own mails
where these switches are on, in addition to the portal's:

- _Goovee Portal_ app configuration, `registrationTemplate`: the ERP's template
  mail for a paid event registration, on top of the portal's registration mail.
- The customer's accounting situation, `invoiceAutomaticMail` with
  `invoiceMessageTemplate` (defaulted from the account configuration): the ERP's
  customer invoice mail at ventilation; `invoiceAutomaticMailOnValidate` with
  `invoiceMessageTemplateOnValidate`: the same at validation. Both on top of the
  portal's shop and marketplace confirmations; never for an event or an invoice
  paid from the portal.
- Supply chain, `customerStockMoveGenerationAuto`, with the partner's stock
  settings `plannedStockMoveAutomaticMail` and its template: the planned stock
  move mail when a shop or marketplace sale order is confirmed.

Leave them off, or accept the second mail.

### ERP mails sent while booking

The ERP sends the mails above from inside the booking of the payment. With the
planned stock move mail switched on but no template set, the mail fails and the
whole booking of a shop or marketplace payment fails with it; it waits under
_Payments to resolve_ until the template is set and _Register payment_ is pressed.
A booking that fails after its mails were queued may send them again when
retried.

### A bank transfer the payer did not complete

A Stripe bank transfer stays open for 14 days from its start; the payer is told
so with its bank details. At the end, the portal cancels it at Stripe, whatever
part of it arrived, and the payment reads cancelled. Money that had arrived was
never in the account's balance: Stripe returns it to the payer's cash balance
there, and finance refunds it from the Stripe dashboard, as any refund. The
portal's log names each one (`[PAYMENT][RECONCILE] … went back to the payer's
Stripe cash balance`); check the customers' cash balances in Stripe weekly
besides.

Check the customer's cash balance in Stripe before refunding: Stripe applies it
to the payer's next open transfer by itself, so money returned by one cancelled
transfer may already have paid another. Refund only what the balance still
holds.

### Money for a withdrawn bank transfer

Stripe keeps one customer per payer address per tenant and applies money
received to that customer's open transfers. A payer with open transfers on two
invoices who wires the first one's amount after its transfer was withdrawn may
see it applied to the second, where the amounts match. Check the customer's
cash balance in Stripe when a wire arrives for an invoice already paid.
