// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Timer} from '@curialy/ui/Timer';
import {Text} from '@curialy/ui/Text';

export default function TimerInline() {
  return (
    <Text type="body" color="primary">
      Processing for <Timer type="inherit" color="inherit" />
    </Text>
  );
}
