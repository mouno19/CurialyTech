// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {IconButton} from '@curialy/ui/IconButton';
import {Icon} from '@curialy/ui/Icon';

export default function IconButtonShowcase() {
  return (
    <IconButton
      label="Settings"
      icon={<Icon icon="wrench" color="inherit" />}
    />
  );
}
