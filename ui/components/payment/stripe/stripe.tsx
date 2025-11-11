'use client';

// ---- CORE IMPORTS ---- //
import {i18n} from '@/locale';
import {PaymentOption} from '@/types';
import {Button} from '@/ui/components';
import {StripeProps} from '@/ui/components/payment/types';
import {useToast} from '@/ui/hooks';

export function Stripe({
  disabled,
  successMessage = 'Payment successful!',
  errorMessage = 'Error processing payment, try again.',
  onValidate,
  onCreateCheckOutSession,
  onValidateSession,
  onPaymentSuccess,
  onApprove,
}: StripeProps) {
  const {toast} = useToast();

  const handleCreateCheckoutSession = async (event: any) => {
    event.preventDefault();

    if (onValidate) {
      const isValid = await onValidate(PaymentOption.stripe);
      if (!isValid) {
        return;
      }
    }
    try {
      const result = await onCreateCheckOutSession();

      if (result.error) {
        toast({
          variant: 'destructive',
          title: result.message,
        });
        return;
      }

      const {url} = result;
      window.location.assign(url as string);
    } catch (err) {
      console.error('Error while creating checkout session:', err);
      toast({
        variant: 'destructive',
        title: i18n.t('Error processing stripe payment, try again.'),
      });
    }
  };

  return (
    <>
      <Button
        className="h-[50px] w-full bg-[#635bff] text-lg font-medium"
        disabled={disabled}
        onClick={handleCreateCheckoutSession}>
        {i18n.t('Pay with Stripe')}
      </Button>
    </>
  );
}

export default Stripe;
