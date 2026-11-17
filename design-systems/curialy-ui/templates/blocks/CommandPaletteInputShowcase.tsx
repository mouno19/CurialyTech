// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useMemo} from 'react';
import {
  CommandPalette,
  CommandPaletteInput,
} from '@curialy/ui/CommandPalette';
import {Kbd} from '@curialy/ui/Kbd';
import {createStaticSource} from '@curialy/ui/Typeahead';

export default function CommandPaletteInputShowcase() {
  const source = useMemo(
    () =>
      createStaticSource([
        {id: 'home', label: 'Home'},
        {id: 'settings', label: 'Settings'},
        {id: 'profile', label: 'Profile'},
        {id: 'help', label: 'Help'},
      ]),
    [],
  );

  return (
    <CommandPalette
      isOpen
      isInline
      onOpenChange={() => {}}
      searchSource={source}
      input={
        <CommandPaletteInput
          placeholder="Search commands, files, or actions..."
          endContent={<Kbd keys="mod+k" />}
        />
      }
    />
  );
}
