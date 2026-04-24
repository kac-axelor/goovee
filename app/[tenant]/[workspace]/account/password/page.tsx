'use client';

import {z} from 'zod';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';

// ---- CORE IMPORTS ---- //
import {i18n} from '@/locale';
import {Button} from '@/ui/components/button';
import {Input} from '@/ui/components/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/components/form';
import {useToast} from '@/ui/hooks';
import {PasswordSchema} from '@/utils/validators';

// ---- LOCAL IMPORTS ---- //
import {Title} from '../common/ui/components';
import {changePassword} from './action';

const formSchema = z
  .object({
    oldPassword: z.string(),
    newPassword: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: i18n.t("Passwords don't match"),
    path: ['confirmPassword'],
  });

export default function Page() {
  const {toast} = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async ({
    oldPassword,
    newPassword,
    confirmPassword,
  }: z.infer<typeof formSchema>) => {
    const result = await changePassword({
      oldPassword,
      newPassword,
      confirmPassword,
    });

    toast({
      title: result?.message,
      variant: result?.error ? 'destructive' : 'success',
    });

    result.success && form.reset();
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="bg-white p-2 lg:p-0 lg:bg-inherit">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="px-2">
          <div className="space-y-20">
            <div className="space-y-4">
              <Title text={i18n.t('Personal Settings')} />
              <FormField
                control={form.control}
                name="oldPassword"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{i18n.t('Old Password')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        value={field.value}
                        placeholder={i18n.t('Enter old password')}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{i18n.t('New Password')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        value={field.value}
                        placeholder={i18n.t('Enter new password')}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{i18n.t('Confirm Password')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        value={field.value}
                        placeholder={i18n.t('Confirm new password')}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4 text-end">
              <Button variant="success" disabled={isSubmitting}>
                {i18n.t('Change password')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
