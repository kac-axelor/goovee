'use client';

import {MdOutlineEdit, MdOutlineDelete, MdOutlineStar} from 'react-icons/md';

// ---- CORE IMPORTS ---- //
import {Button} from '@/ui/components/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/ui/components/alert-dialog';
import {Tag} from '@/ui/components/tag';
import {i18n} from '@/locale';
import {cn} from '@/utils/css';
import {ADDRESS_TYPE} from '@/constants';
import {useState} from 'react';

export const AddressCard = ({
  id,
  isSelected,
  isDefault,
  type,
  address,
  onSelect,
  onEdit,
  onDelete,
  onDefault,
}: {
  id: string;
  isSelected: boolean;
  type: ADDRESS_TYPE;
  isDefault?: boolean;
  address: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    addressl4?: string;
    addressl6?: string;
    zip?: string;
    country?: {name: string};
  };
  onSelect?: (type: ADDRESS_TYPE, address: any) => void;
  onEdit: (type: ADDRESS_TYPE, id: string) => void;
  onDefault?: (type: ADDRESS_TYPE, id: string, isDefault?: boolean) => void;
  onDelete: (id: string) => void;
}) => {
  const {
    firstName = '',
    lastName = '',
    companyName = '',
    addressl4 = '',
    addressl6 = '',
    zip = '',
    country,
  } = address || {};

  const [confirmationDialog, setConfirmationDialog] = useState(false);

  const handleSelect = () => onSelect && onSelect(type, address);

  const handleDefault = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onDefault?.(type, id, !isDefault);
  };

  const handleEdit = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onEdit(type, id);
  };

  const handleDelete = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();

    closeConfirmation();

    onDelete?.(id);
  };

  const openConfirmation = () => {
    setConfirmationDialog(true);
  };

  const closeConfirmation = () => {
    setConfirmationDialog(false);
  };

  const formatAddressHeader = (
    firstName: string,
    lastName: string,
    companyName: string,
  ) => {
    const nameParts = [firstName, lastName].filter(Boolean).join(' ');
    return [nameParts, companyName].filter(Boolean).join(', ');
  };

  return (
    <>
      <div
        onClick={handleSelect}
        className={cn(
          'min-h-56 flex flex-col justify-between gap-4 rounded-lg p-4 border cursor-pointer hover:bg-success-light h-full',
          isSelected ? 'bg-success-light border-black' : 'border-gray-300',
        )}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-base line-clamp-2">
              {formatAddressHeader(firstName, lastName, companyName)}
            </div>
            {isDefault && (
              <Tag
                className="font-bold text-[0.5rem] p-1"
                variant="default"
                outline>
                {i18n.t('Default')}
              </Tag>
            )}
          </div>
          <div className="text-sm leading-[1.313rem] font-normal">
            {[addressl4, addressl6, zip, country?.name].map(
              (line, index) => line && <p key={index}>{line}</p>,
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center justify-end">
          <Button
            className="h-9 flex items-center gap-2 bg-white hover:bg-success hover:text-white border border-success text-success rounded-md font-medium px-3 py-1.5"
            onClick={handleEdit}>
            <MdOutlineEdit className="w-6 h-6" />
            {i18n.t('Edit')}
          </Button>
          <Button
            variant="destructive"
            className="h-9 flex items-center gap-2 rounded-md font-medium px-3 py-1.5"
            onClick={openConfirmation}>
            <MdOutlineDelete className="w-6 h-6" />
          </Button>
          <Button
            variant={isDefault ? 'default' : 'outline'}
            className={cn(
              'h-9 flex items-center gap-2 rounded-md font-medium px-3 py-1.5',
              {
                'border border-primary': isDefault,
              },
            )}
            onClick={handleDefault}>
            <MdOutlineStar className="w-6 h-6" />
          </Button>
        </div>
      </div>
      <AlertDialog open={Boolean(confirmationDialog)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {i18n.t('Do you want to delete address?')}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirmation}>
              {i18n.t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {i18n.t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AddressCard;
