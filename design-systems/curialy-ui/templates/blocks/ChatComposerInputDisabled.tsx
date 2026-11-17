// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ChatComposer, ChatComposerInput} from '@curialy/ui/Chat';
import {Stack} from '@curialy/ui/Layout';

export default function ChatComposerInputDisabled() {
  return (
    <Stack direction="vertical" width={450} maxWidth="100%">
      <ChatComposer
        onSubmit={() => {}}
        isDisabled
        input={<ChatComposerInput isDisabled placeholder="Input is disabled" />}
      />
    </Stack>
  );
}
