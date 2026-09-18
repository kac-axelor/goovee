'use client';

import {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {i18n} from '@/locale';
import {formatDateTime} from '@/locale/formatters';
import {Button} from '@/ui/components';
import {useWorkspace} from '@/app/[tenant]/[workspace]/workspace-context';
import {PAYMENT_STATUS} from '@/payment/domain/types';
import type {PaymentView} from '@/payment/view';

/** Poll cadence: fast at first, backing off, and giving up after a few minutes. */
const FIRST_POLL_MS = 1000;
const MAX_POLL_MS = 5000;
const POLL_BUDGET_MS = 3 * 60 * 1000;

function formatMoney(
  minor: number,
  currencyCode: string,
  scale: number,
): string {
  const value = minor / 10 ** scale;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    }).format(value);
  } catch {
    return `${value.toFixed(scale)} ${currencyCode}`;
  }
}

type Presentation = {
  tone: 'success' | 'pending' | 'failure' | 'neutral';
  heading: string;
  body: string;
};

function presentationOf(view: PaymentView, gaveUp: boolean): Presentation {
  const amount = formatMoney(
    view.amount,
    view.currencyCode,
    view.currencyScale,
  );
  const captured = formatMoney(
    view.capturedAmount,
    view.currencyCode,
    view.currencyScale,
  );

  switch (view.status) {
    case PAYMENT_STATUS.captured:
      if (view.deliveryStatus === 'undeliverable') {
        return {
          tone: 'pending',
          heading: i18n.t('Payment received'),
          body: i18n.t(
            'Your payment of {0} has been received. We could not complete your order automatically; our team will contact you.',
            amount,
          ),
        };
      }
      if (!view.projected) {
        return {
          tone: 'success',
          heading: i18n.t('Payment received'),
          body: gaveUp
            ? i18n.t(
                'Your payment of {0} has been received. We are finalising it and will email you when it is complete.',
                amount,
              )
            : i18n.t(
                'Your payment of {0} has been received. Finalising your order…',
                amount,
              ),
        };
      }
      return {
        tone: 'success',
        heading: i18n.t('Payment complete'),
        body: i18n.t(
          'Your payment of {0} has been received and recorded.',
          amount,
        ),
      };
    case PAYMENT_STATUS.partiallyCaptured:
      return {
        tone: 'pending',
        heading: i18n.t('Partly received'),
        body: i18n.t(
          '{0} of {1} has been received. The remainder is still expected.',
          captured,
          amount,
        ),
      };
    case PAYMENT_STATUS.refused:
      return {
        tone: 'failure',
        heading: i18n.t('Payment declined'),
        body: i18n.t(
          'Your payment provider declined the payment. Nothing has been charged.',
        ),
      };
    case PAYMENT_STATUS.cancelled:
      return {
        tone: 'neutral',
        heading: i18n.t('Payment cancelled'),
        body: i18n.t('The payment was cancelled. Nothing has been charged.'),
      };
    case PAYMENT_STATUS.expired:
      return {
        tone: 'neutral',
        heading: i18n.t('This payment session expired'),
        body: i18n.t(
          'The payment was not completed in time. Nothing has been charged.',
        ),
      };
    case PAYMENT_STATUS.refunded:
      return {
        tone: 'neutral',
        heading: i18n.t('Payment refunded'),
        body: i18n.t('This payment of {0} has been refunded.', amount),
      };
    case PAYMENT_STATUS.chargedBack:
      return {
        tone: 'failure',
        heading: i18n.t('Payment disputed'),
        body: i18n.t(
          'This payment of {0} is under dispute. Please contact support.',
          amount,
        ),
      };
    default:
      return {
        tone: 'pending',
        heading: i18n.t('Waiting for confirmation'),
        body: gaveUp
          ? i18n.t(
              'We have not heard back from your payment provider yet. We will email you once the payment of {0} is confirmed.',
              amount,
            )
          : i18n.t('Confirming your payment of {0}…', amount),
      };
  }
}

const TONE_CLASSES: Record<Presentation['tone'], string> = {
  success: 'border-success bg-success-light text-success-dark',
  pending: 'border-palette-blue bg-palette-blue-light text-ink-900',
  failure: 'border-error bg-error-light text-error-dark',
  neutral: 'border-ink-200 bg-white text-ink-900',
};

export function PaymentResult({
  initial,
  statusPath,
}: {
  initial: PaymentView;
  statusPath: string;
}) {
  const [view, setView] = useState(initial);
  const [gaveUp, setGaveUp] = useState(false);
  const {scope} = useWorkspace();
  const router = useRouter();
  const startedAt = useRef<number | null>(null);

  /* Zero polls in the common case: the return route settled before the
   * redirect and the first render is already final. */
  useEffect(() => {
    if (view.settled || gaveUp) {
      return;
    }
    startedAt.current ??= Date.now();
    let delay = FIRST_POLL_MS;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - (startedAt.current ?? Date.now()) > POLL_BUDGET_MS) {
        setGaveUp(true);
        return;
      }
      try {
        const response = await fetch(statusPath, {cache: 'no-store'});
        if (response.ok) {
          const next = (await response.json()) as PaymentView;
          if (!cancelled) {
            setView(next);
            if (next.settled) {
              router.refresh();
              return;
            }
          }
        }
      } catch {
        /* A failed poll is retried on the next tick. */
      }
      delay = Math.min(delay * 2, MAX_POLL_MS);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view.settled, gaveUp, statusPath, router]);

  const presentation = presentationOf(view, gaveUp);
  /* The onward link goes back to the checkout for a payment that ended with
   * nothing charged, and on to what was bought otherwise. */
  const endedWithoutPayment =
    view.status === PAYMENT_STATUS.refused ||
    view.status === PAYMENT_STATUS.cancelled ||
    view.status === PAYMENT_STATUS.expired;
  const onwardHref = view.onwardLink ? scope.forRouter(view.onwardLink) : null;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <div
        className={`rounded-lg border p-6 ${TONE_CLASSES[presentation.tone]}`}>
        <h1 className="text-2xl font-semibold">{presentation.heading}</h1>
        <p className="mt-2 text-base">{presentation.body}</p>
        <dl className="mt-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-500">{i18n.t('Reference')}</dt>
            <dd className="font-mono">{view.reference}</dd>
          </div>
          {view.subjectLabel && (
            <div>
              <dt className="text-ink-500">{i18n.t('For')}</dt>
              <dd>{view.subjectLabel}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-500">{i18n.t('Amount')}</dt>
            <dd>
              {formatMoney(view.amount, view.currencyCode, view.currencyScale)}
            </dd>
          </div>
          {view.capturedOn && (
            <div>
              <dt className="text-ink-500">{i18n.t('Received on')}</dt>
              <dd>{formatDateTime(view.capturedOn)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {onwardHref && (
            <Button onClick={() => router.push(onwardHref)}>
              {endedWithoutPayment ? i18n.t('Try again') : i18n.t('Continue')}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => router.push(scope.forRouter())}>
            {i18n.t('Back to home')}
          </Button>
        </div>
      </div>
    </div>
  );
}
