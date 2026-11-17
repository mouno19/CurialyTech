// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ChatSendButton} from '@curialy/ui/Chat';
import {Icon} from '@curialy/ui/Icon';
import {Stack} from '@curialy/ui/Layout';
import {SparklesIcon} from '@heroicons/react/24/solid';

export default function ChatSendButtonShowcase() {
  return (
    <Stack direction="horizontal" gap={3} vAlign="center">
      <ChatSendButton isDisabled={false} onSend={() => {}} />
      <ChatSendButton
        isDisabled={false}
        onSend={() => {}}
        sendIcon={<Icon icon={SparklesIcon} size="sm" />}
      />
      <ChatSendButton isStopShown onStop={() => {}} />
    </Stack>
  );
}
