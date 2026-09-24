export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Schedule the staged-upload reaper (non-blocking — just arms timers).
  const {startStagedUploadReaper} = await import('@/upload/startup');
  startStagedUploadReaper();

  // Run the payment jobs goovee owns (non-blocking — just arms timers).
  const {startPaymentJobs} = await import('@/payment/job-startup');
  startPaymentJobs();

  // Report whether images can be resized. Never throws, never blocks startup.
  const {checkImageResizing} = await import('@/image/startup');
  void checkImageResizing();

  // Report whether mail can be delivered. Never throws, never blocks startup.
  const {checkMailTransport} = await import('@/notification/startup');
  void checkMailTransport();

  // Report whether push notifications can be sent.
  const {checkPushConfig} = await import('@/pwa/startup');
  checkPushConfig();

  /* Prepares every database and connects every tenant in the background. A
   * database that is not reachable yet is retried with backoff, and one tenant
   * failing never holds up the rest. Payments left open when the server last
   * stopped are the payment jobs' to look at, not something resumed here. */
  const {startTenants} = await import('@/tenant/startup');
  const {probeTenantPayments} = await import('@/payment/schema-probe');

  /* Each tenant's database is checked for the payment schema as soon as it is
   * connected, so a stale one is reported at boot rather than at the first
   * checkout; its payments stay off until it matches. */
  startTenants(probeTenantPayments);
}
