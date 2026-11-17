// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Timer} from '@curialy/ui/Timer';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function TimerTypography() {
  const [startedAt] = useState(() => Date.now() - 128_000);

  return (
    <Stack direction="vertical" gap={3}>
      <Text type="supporting" color="secondary">
        Default
      </Text>
      <Timer startTime={startedAt} />
      <Text type="supporting" color="secondary">
        Emphasized
      </Text>
      <Timer
        startTime={startedAt}
        type="body"
        size="xl"
        color="primary"
        weight="semibold"
      />
    </Stack>
  );
}
