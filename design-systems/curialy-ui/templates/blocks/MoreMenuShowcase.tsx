// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {MoreMenu} from '@curialy/ui/MoreMenu';

export default function MoreMenuShowcase() {
  return (
    <MoreMenu
      items={[
        {label: 'Edit', onClick: () => {}},
        {label: 'Duplicate', onClick: () => {}},
        {label: 'Delete', onClick: () => {}},
      ]}
    />
  );
}
