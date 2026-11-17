// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {DateTimeInput} from '@curialy/ui/DateTimeInput';
import type {ISODateTimeString} from '@curialy/ui/DateTimeInput';
import {Stack} from '@curialy/ui/Layout';

export default function DateTimeInputShowcase() {
  const [dateTime, setDateTime] = useState<ISODateTimeString | undefined>(
    undefined,
  );

  return (
    <Stack
      direction="vertical"
      width="100%"
      style={{minWidth: 240, maxWidth: 400}}>
      <DateTimeInput
        label="Meeting time"
        placeholder="Select a date"
        value={dateTime}
        onChange={setDateTime}
        hasClear
      />
    </Stack>
  );
}
