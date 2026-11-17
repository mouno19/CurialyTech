// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, useMemo} from 'react';
import {CommandPalette} from '@curialy/ui/CommandPalette';
import {Text} from '@curialy/ui/Text';
import {Icon} from '@curialy/ui/Icon';
import {createStaticSource} from '@curialy/ui/Typeahead';

export default function CommandPalettePickerMode() {
  const [theme, setTheme] = useState('light');
  const source = useMemo(
    () =>
      createStaticSource([
        {id: 'light', label: 'Light'},
        {id: 'dark', label: 'Dark'},
        {id: 'system', label: 'System'},
      ]),
    [],
  );

  return (
    <CommandPalette
      isOpen
      isInline
      onOpenChange={() => {}}
      searchSource={source}
      value={theme}
      onValueChange={setTheme}
      renderItem={(item, isSelected) => (
        <>
          <Text type="body" style={{flex: 1}}>
            {item.label}
          </Text>
          {isSelected && <Icon icon="check" size="sm" />}
        </>
      )}
    />
  );
}
