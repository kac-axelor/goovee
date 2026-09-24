# Extending payments

How to add a payment provider or an app that takes payments. Both touch this
repository and axelor-portal; the release compatibility matrix is what keeps
the two in step, so a change here ships with its counterpart there.

A payment is one row per purchase attempt, `portal_portal_payment`, with every
provider event kept against it in a ledger. goovee writes the row and the
ledger; the ERP books a captured payment into its own records (the projection)
and shows the payment to finance.

## Adding a provider

In goovee:

1. Add the provider's value to `GATEWAY` in `domain/types.ts`.
2. Write an adapter implementing `GatewayAdapter` (`adapters/types.ts`):
   - `capabilities`:
     - `queryable` — the provider can be asked what became of a session;
       implement `fetchStatus`, and throw `SessionNotFoundError` only for "no
       such session";
     - `settlesOnReturn` — the browser's return may settle a payment;
     - `partialCapture` — a session can be funded in part and stay open for the
       rest;
     - `chargesOnStart` — creating a session can move money before the payer
       acts.
   - `reconcile` — when the reconcile job looks at an open session, and when an
     unresolved one goes to a person: `timedFrom: 'expiry'` with `recheckMs` and
     `decideAfterExpiryMs`, or `timedFrom: 'start'` with `recheckMs`,
     `firstCheckAfterMs` and `decideAfterMs` for a payment with no expiry.
   - `isConfigured`, `createSession`, `parseReturn` and `parseNotification`, and
     `describeAwaiting` / `cancelAwaiting` where the payer pays later against
     instructions. `createSession` answers with a handoff of kind `redirect`,
     `form-post` or `sdk`; a new kind fails the exhaustive check in
     `performHandoff`, and `sdk` needs its own button in `PaymentMethods`.
   - Every signal carries `eventId`, the provider's own id for the event,
     identical whichever leg observed it. Never build a key: settle keys the
     ledger by one rule, `eventKeyOf` in `domain/signal.ts`. Where one provider
     id names several events of one kind, make the id compound, as HUB PISP's
     `<request>:CANC` does. Amounts are minor units at the currency's ISO
     scale. `correlationRefs` lists every id a later refund or dispute may
     name.
3. Register the adapter in the `adapters` record of `adapters/registry.ts`, and
   give it a case in `paymentOptionFor` and a value in `PaymentOption`
   (`types/index.ts`). The registry is checked when it loads, since the build
   does not type-check.
4. Add its notification route, `app/[tenant]/api/webhooks/<provider>/route.ts`,
   calling `handleNotification`.
5. Add its settings to `lib/core/config/schema.ts` and run
   `pnpm config:generate`. Add its secrets to the taint list in
   `lib/core/tenant/config.ts`, which keeps them out of the browser, and a
   cross-tenant check in `lib/core/config/schema.ts` if two tenants must never
   share one, as HUB PISP's certificates must not.
6. Add the gateway to the `gateways` list of each source that may offer it.
7. For a provider the payer pays later against instructions, offered to
   invoices only: add it to `TRANSFER_GATEWAYS` in `domain/transfers.ts`, which
   feeds the pending list, the part-funded refusal and the invoice's transfer
   guard; check `stillOpen` in `invoices/common/payment/pending.ts`, which reads
   HUB PISP's expiry by name; and implement `describeAwaiting` for the pending
   list to show the payment details.
8. Only where the provider reports an event the ledger has no type for: add it
   to `EVENT_TYPE`, give it a prefix in `KEY_PREFIX` (`domain/signal.ts`), and
   say what it does to the status in `deriveStatus`.

In axelor-portal:

1. Add the provider to `portal.payment.gateway.select` and
   `payment.config.type.select`.
2. For a new event type from step 8 above: its prefix in
   `PortalPaymentEventKeys`, which keys the events a person enters by hand, and
   its option in `portal.payment.event.type.select`.

Nothing else: an event entered by hand is keyed as the provider's own, the
currency-scale check covers every provider, and the schema check at startup
needs no change. Document the provider's notification address and events in
CONFIGURATION.md and the upgrade's runbook.

## Adding an app that takes payments

In goovee:

1. Add the source's value to `PAYMENT_SOURCE` in `domain/types.ts`.
2. Register what its payments are for in `domain/subject.ts`: the model in
   `SUBJECT_MODEL`, its table and whether it carries one payment only in
   `SUBJECTS`, and the source's models in `MODELS_BY_SOURCE`.
3. Write a handler implementing `PaymentSourceHandler` (`sources/types.ts`):
   - `intentSchema` and `gateways`, and `requiresPaymentMode` where the ERP
     cannot book a payment without one;
   - `prepare` — authorise the caller and price the purchase; a record that
     exists before the payment, such as the invoice being paid, is its
     `subject`;
   - `deliver` — the work a full capture unlocks, inside the settle
     transaction; it returns the record it created as the payment's subject,
     or null to keep the one from `prepare`. It runs on the payer's return, a
     provider's webhook or a job, so it reads no session, cookie or header;
   - `notify` — the confirmation, run as a job; translate what the payer reads
     with `getTranslation` in their locale;
   - `onwardLink` — where the result page sends the payer next.
4. Register the handler in the `handlers` record of `sources/registry.ts`, which
   is checked when it loads. Import a handler only through the registry: the
   invoices handler reaches settle, which imports the registry, so importing a
   handler first fails the check at startup.
5. On the app's checkout page, render `PaymentMethods` with
   `await offeredGateways({source, paymentOptions, tenant})`. It offers nothing
   while the tenant's database fails the schema check.
6. For a subject entity new to goovee, add its schema mirror with
   `"synchronize": false`; if payments write it, add it to `PAYMENT_SCHEMAS` in
   `schema-probe.ts`.

In axelor-portal:

1. Add the source to `portal.payment.source.select`, and its model to
   `portal.payment.subject.select`.
2. Write a `PortalPaymentProjector` for the source, which books a captured
   payment into the ERP, and bind it in the projector set in `PortalModule`.
3. Write a `PortalPaymentSubject<T>` for the model — the sources that pay for
   it, whether it carries one payment only, how a record picked by hand is
   checked, how its own ERP links agree with those booked by hand, and the
   customers it names — and bind it in the subject set in `PortalModule`. The
   binding order is the order a person is offered the models in. An app paying
   for a model that already has one adds its source to that subject's
   `sources()` instead.
4. Add the _Portal payments_ dashlet, `action.portal.payment.for.subject`, to
   the subject's form.
