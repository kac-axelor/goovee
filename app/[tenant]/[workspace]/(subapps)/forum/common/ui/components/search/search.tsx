'use client';

import {useEffect, useMemo, useState} from 'react';
import {MdOutlineSearch} from 'react-icons/md';
import {debounce} from 'lodash-es';

// ---- CORE IMPORTS ---- //
import {Button, Input} from '@/ui/components';
import {SEARCH_HERE} from '@/subapps/forum/common/constants';
import {i18n} from '@/locale';

export const Search = ({
  onChange = () => {},
}: {
  onChange?: (value: string) => void;
}) => {
  const [searchValue, setSearchValue] = useState<string>('');

  const debouncedOnChange = useMemo(
    () =>
      debounce((value: string) => {
        onChange(value);
      }, 300),
    [onChange],
  );

  useEffect(() => {
    debouncedOnChange(searchValue);
    return () => {
      debouncedOnChange.cancel();
    };
  }, [searchValue, debouncedOnChange]);

  return (
    <div className="relative">
      <Input
        value={searchValue}
        className="border-none placeholder:text-sm"
        placeholder={i18n.t(SEARCH_HERE)}
        onChange={e => {
          const value = e.target.value;
          setSearchValue(value);
        }}
      />
      <Button
        variant="success"
        className="px-2 py-1 h-7 w-9 absolute top-1.5 right-[0.563rem]">
        <MdOutlineSearch className="w-5 h-5" />
      </Button>
    </div>
  );
};

export default Search;
