'use client';

import {useState} from 'react';
import {EllipsisVertical} from 'lucide-react';

// ---- CORE IMPORTS ---- //
import {i18n} from '@/locale';
import {formatDate} from '@/locale/formatters';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components';
import {GATEWAY} from '@/payment/domain/types';
import {
  formatMoney,
  TransferInstructions,
} from '@/ui/components/payment/transfer-instructions';

// ---- LOCAL IMPORTS ---- //
import type {PendingTransfer} from '@/subapps/invoices/common/payment/pending';

function PendingTransferEntry({transfer}: {transfer: PendingTransfer}) {
  const [showDetails, setShowDetails] = useState(false);
  const {instructions, currencyCode, currencyScale} = transfer;
  /* The reference the bank transfer must quote, which is the provider's, not
   * the payment's own. */
  const transferReference = instructions?.reference;
  const partlyReceived = transfer.remaining < transfer.amount;
  const hasActions = Boolean(instructions || transfer.href);

  return (
    <li className="flex items-center justify-between gap-2 rounded border border-ink-150 bg-white p-2">
      <div className="flex flex-col">
        <span className="font-medium tabular-nums">
          {formatMoney(transfer.amount, currencyCode, currencyScale)}
        </span>
        {partlyReceived && (
          <span className="text-xs">
            <span className="font-medium">{i18n.t('Remaining')}:</span>{' '}
            <span className="font-semibold tabular-nums">
              {formatMoney(transfer.remaining, currencyCode, currencyScale)}
            </span>
          </span>
        )}
        {transfer.startedOn && (
          <span className="text-xs text-ink-500">
            {formatDate(transfer.startedOn, {dateFormat: 'YYYY-MM-DD'})}
          </span>
        )}
      </div>

      {hasActions && (
        /* Not modal: a modal menu that opens a dialog from one of its items can
         * leave the page unclickable once the dialog closes. */
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={i18n.t('Actions')}
            className="rounded p-1 hover:bg-ink-50">
            <EllipsisVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {instructions && (
              <DropdownMenuItem onSelect={() => setShowDetails(true)}>
                {i18n.t('Show Bank Details')}
              </DropdownMenuItem>
            )}
            {transferReference && (
              <DropdownMenuItem
                onSelect={() =>
                  void navigator.clipboard.writeText(transferReference)
                }>
                {i18n.t('Copy Reference')}
              </DropdownMenuItem>
            )}
            {transfer.href && (
              <DropdownMenuItem asChild>
                <a href={transfer.href}>{i18n.t('View payment')}</a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {instructions && (
        <Dialog open={showDetails} onOpenChange={setShowDetails}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{i18n.t('Bank Transfer Payment')}</DialogTitle>
              <DialogDescription>
                {i18n.t('Transfer funds using the following bank information:')}
              </DialogDescription>
            </DialogHeader>
            <TransferInstructions
              instructions={instructions}
              currencyCode={currencyCode}
              currencyScale={currencyScale}
            />
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

function PendingTransferGroup({
  heading,
  transfers,
}: {
  heading: string;
  transfers: PendingTransfer[];
}) {
  if (!transfers.length) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-yellow-200 bg-yellow-50/50 p-3 text-sm">
      <h3 className="font-semibold text-ink-900">{heading}</h3>
      <ul className="flex flex-col gap-2">
        {transfers.map(transfer => (
          <PendingTransferEntry key={transfer.reference} transfer={transfer} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Transfers started on the invoice that the payer's bank has not finished,
 * grouped by how they were started. Each carries what the payer needs to
 * complete it; a transfer that settles is no longer listed and is counted in
 * what remains to pay.
 */
export function PendingTransfers({transfers}: {transfers: PendingTransfer[]}) {
  const stripe = transfers.filter(
    transfer => transfer.gateway === GATEWAY.stripeBankTransfer,
  );
  const hubpisp = transfers.filter(
    transfer => transfer.gateway === GATEWAY.hubpisp,
  );
  return (
    <>
      <PendingTransferGroup
        heading={i18n.t('Pending Stripe Bank transfers')}
        transfers={stripe}
      />
      <PendingTransferGroup
        heading={i18n.t('Pending HUB PISP payments')}
        transfers={hubpisp}
      />
    </>
  );
}
