'use client';

import {MdAdd} from 'react-icons/md';
import {Swiper, SwiperSlide} from 'swiper/react';
import {Pagination} from 'swiper/modules';

// ---- CORE IMPORTS ---- //
import {Button} from '@/ui/components';
import {i18n} from '@/locale';
import {ADDRESS_TYPE} from '@/constants';

// ---- LOCAL IMPORTS ---- //
import {AddressCard} from '@/app/[tenant]/[workspace]/account/addresses/common/ui/components';

export const AddressesList = ({
  isFromQuotation,
  currentAddress,
  addresses,
  type,
  onEdit,
  onCreate,
  onSelect,
  onDelete,
  onDefault,
}: {
  isFromQuotation?: boolean;
  currentAddress?: {id: string} | null;
  addresses: {id: string; isDefaultAddr?: boolean; address: any}[];
  type: ADDRESS_TYPE;
  onCreate: (type: ADDRESS_TYPE) => void;
  onEdit: (type: ADDRESS_TYPE, id: string) => void;
  onSelect?: (type: ADDRESS_TYPE, address: any) => void;
  onDelete: (id: string) => void;
  onDefault?: (type: ADDRESS_TYPE, id: string, isDefault: boolean) => void;
}) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="">
        {addresses.length === 0 ? (
          <div className="text-muted-foreground text-sm italic px-2">
            {i18n.t('No addresses available. Please create a new address.')}
          </div>
        ) : (
          <Swiper
            slidesPerView="auto"
            spaceBetween={30}
            modules={[Pagination]}
            pagination={{
              dynamicBullets: true,
              horizontalClass: '!bottom-0',
            }}
            className="min-h-[15.5rem] flex">
            {addresses.map(({id, address, isDefaultAddr}) => {
              const isSelected = isFromQuotation
                ? currentAddress?.id === address.id
                : currentAddress?.id === id;

              return (
                <SwiperSlide
                  key={address.id}
                  className="!w-[17.563rem] !h-auto">
                  <AddressCard
                    id={id}
                    address={address}
                    type={type}
                    isSelected={isSelected}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDefault={onDefault}
                    onSelect={() => onSelect?.(type, {id, address})}
                    isDefault={isDefaultAddr}
                  />
                </SwiperSlide>
              );
            })}
          </Swiper>
        )}
      </div>

      <Button
        variant="success"
        className="w-fit h-9 flex items-center gap-2 rounded-md font-medium px-3 py-1.5"
        onClick={() => onCreate(type)}>
        <MdAdd className="w-6 h-6" />
        {i18n.t('Create address')}
      </Button>
    </div>
  );
};

export default AddressesList;
