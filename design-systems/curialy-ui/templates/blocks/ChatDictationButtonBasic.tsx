// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useRef} from 'react';
import {
  ChatDictationButton,
  ChatComposer,
  ChatComposerInput,
  useChatDictation,
} from '@curialy/ui/Chat';
import type {ChatComposerInputHandle} from '@curialy/ui/Chat';
import {Stack} from '@curialy/ui/Layout';

export default function ChatDictationButtonBasic() {
  const inputRef = useRef<ChatComposerInputHandle>(null);

  const dictation = useChatDictation({
    inputRef,
    onResult: text => {
      console.log('Dictation result:', text);
    },
  });

  return (
    <Stack direction="vertical" width={450} maxWidth="100%">
      <ChatComposer
        onSubmit={value => console.log('Submit:', value)}
        input={<ChatComposerInput handleRef={inputRef} />}
        sendActions={<ChatDictationButton dictation={dictation} />}
      />
    </Stack>
  );
}
