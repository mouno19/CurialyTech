// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {NavIcon} from '@curialy/ui/NavIcon';
import {Icon} from '@curialy/ui/Icon';
import {HStack} from '@curialy/ui/Layout';

export default function NavIconBasic() {
  return (
    <HStack gap={4} vAlign="center">
      <NavIcon icon={<Icon icon="search" />} />
      <NavIcon icon={<Icon icon="calendar" />} />
    </HStack>
  );
}
