// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ChatComposer} from '@curialy/ui/Chat';
import {Stack} from '@curialy/ui/Layout';

export default function ChatComposerSimple() {
  return (
    <Stack direction="vertical" width={450} maxWidth="100%">
      <ChatComposer
        onSubmit={value => {
          console.log('Sent:', value);
        }}
      />
    </Stack>
  );
}
