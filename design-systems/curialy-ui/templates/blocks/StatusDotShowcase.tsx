// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {StatusDot} from '@curialy/ui/StatusDot';
import {HStack} from '@curialy/ui/Layout';

export default function StatusDotShowcase() {
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant="success" label="Positive" />
      <StatusDot variant="warning" label="Warning" />
      <StatusDot variant="error" label="Negative" />
      <StatusDot variant="accent" label="Info" />
      <StatusDot variant="neutral" label="Neutral" />
    </HStack>
  );
}
