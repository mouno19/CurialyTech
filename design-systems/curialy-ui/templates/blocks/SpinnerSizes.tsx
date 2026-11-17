// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Spinner} from '@curialy/ui/Spinner';
import {HStack} from '@curialy/ui/Layout';

export default function SpinnerSizes() {
  return (
    <HStack gap={4} vAlign="center">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
      <Spinner size="xl" />
    </HStack>
  );
}
