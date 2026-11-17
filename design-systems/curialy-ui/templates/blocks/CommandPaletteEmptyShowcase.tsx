// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useMemo} from 'react';
import {CommandPalette} from '@curialy/ui/CommandPalette';
import {Text} from '@curialy/ui/Text';
import {createStaticSource} from '@curialy/ui/Typeahead';

export default function CommandPaletteEmptyShowcase() {
  const emptySource = useMemo(() => createStaticSource([]), []);

  return (
    <CommandPalette
      isOpen
      isInline
      onOpenChange={() => {}}
      searchSource={emptySource}
      emptyBootstrapText={
        <Text type="supporting" color="secondary">
          No commands available yet
        </Text>
      }
    />
  );
}
