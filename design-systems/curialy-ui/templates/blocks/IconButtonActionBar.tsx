// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {IconButton} from '@curialy/ui/IconButton';
import {Icon} from '@curialy/ui/Icon';
import {HStack} from '@curialy/ui/Stack';

export default function IconButtactionBar() {
  return (
    <HStack gap={1}>
      <IconButton
        label="Search"
        icon={<Icon icon="search" color="inherit" />}
        variant="ghost"
      />
      <IconButton
        label="Copy"
        icon={<Icon icon="copy" color="inherit" />}
        variant="ghost"
      />
      <IconButton
        label="Info"
        icon={<Icon icon="info" color="inherit" />}
        variant="ghost"
      />
      <IconButton
        label="Menu"
        icon={<Icon icon="menu" color="inherit" />}
        variant="ghost"
      />
      <IconButton
        label="Close"
        icon={<Icon icon="close" color="inherit" />}
        variant="ghost"
      />
    </HStack>
  );
}
