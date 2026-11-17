// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {DropdownMenu} from '@curialy/ui/DropdownMenu';

export default function DropdownMenuShowcase() {
  return (
    <DropdownMenu
      button={{label: 'Actions'}}
      items={[
        {label: 'Edit', onClick: () => {}},
        {label: 'Duplicate', onClick: () => {}},
        {label: 'Delete', onClick: () => {}},
      ]}
    />
  );
}
