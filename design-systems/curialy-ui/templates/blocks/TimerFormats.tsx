// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Timer} from '@curialy/ui/Timer';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function TimerFormats() {
  const [startedAt] = useState(() => Date.now() - 3_753_000);

  return (
    <Stack direction="vertical" gap={3}>
      <Stack direction="horizontal" gap={3} vAlign="center">
        <Text type="supporting" color="secondary">
          Elapsed
        </Text>
        <Timer startTime={startedAt} type="body" color="primary" />
      </Stack>
      <Stack direction="horizontal" gap={3} vAlign="center">
        <Text type="supporting" color="secondary">
          Clock
        </Text>
        <Timer
          format="clock"
          startTime={startedAt}
          type="body"
          color="primary"
        />
      </Stack>
    </Stack>
  );
}
