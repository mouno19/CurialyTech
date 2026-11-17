// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ChatSendButton} from '@curialy/ui/Chat';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ChatSendButtonStates() {
  return (
    <Stack direction="vertical" gap={2}>
      <Text type="supporting" color="secondary">
        Disabled → Ready → Streaming
      </Text>
      <Stack direction="horizontal" gap={3} vAlign="center">
        <ChatSendButton isDisabled onSend={() => {}} />
        <ChatSendButton isDisabled={false} onSend={() => {}} />
        <ChatSendButton isStopShown onStop={() => {}} />
      </Stack>
    </Stack>
  );
}
