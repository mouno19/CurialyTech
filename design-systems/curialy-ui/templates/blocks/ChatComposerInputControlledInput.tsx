// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {ChatComposer, ChatComposerInput} from '@curialy/ui/Chat';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ChatComposerInputControlledInput() {
  const [value, setValue] = useState('');
  return (
    <Stack direction="vertical" gap={3} width={450} maxWidth="100%">
      <ChatComposer
        onSubmit={() => setValue('')}
        value={value}
        onChange={setValue}
        input={
          <ChatComposerInput
            value={value}
            onChange={setValue}
            placeholder="Type a message..."
          />
        }
      />
      <Text type="supporting" color="secondary">
        Value: {JSON.stringify(value)}
      </Text>
    </Stack>
  );
}
