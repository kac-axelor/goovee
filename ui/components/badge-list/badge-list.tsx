'use client';

// ---- CORE IMPORTS ----//
import {Badge} from '@/ui/components';
import {cn} from '@/utils/css';
import {PALETTE_COLORS} from '@/constants/theme';

export const BadgeList = ({
  items,
  rootClassName,
  labelClassName,
  onSelect,
}: {
  items: any[] | undefined;
  rootClassName?: string;
  labelClassName?: string;
  onSelect?: (item: any) => void;
}) => {
  return (
    <div
      className={cn(
        'flex items-center flex-wrap gap-y-2 gap-x-4 h-fit',
        rootClassName,
      )}>
      {items?.map((item: any) => {
        return (
          <Badge
            key={item?.id}
            className={cn(
              `rounded-2xl shrink-0 px-2 py-1 text-[0.625rem] font-normal w-fit border-none`,
              labelClassName,
              item?.color
                ? `bg-palette-${item.color}-dark hover:bg-palette-${item.color}-dark ${
                    item.color === PALETTE_COLORS.white
                      ? 'text-black'
                      : 'text-white'
                  }`
                : `bg-black text-white`,
            )}
            onClick={() => onSelect && onSelect(item)}>
            {item?.name}
          </Badge>
        );
      })}
    </div>
  );
};

export default BadgeList;
