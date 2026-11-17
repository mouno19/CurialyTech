// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {useClipboard} from '@curialy/ui/hooks';
import {HStack, StackItem, VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import {TextInput} from '@curialy/ui/TextInput';

const INVITE_LINK = 'https://example.com/invite/q7x2k9';

export default function UseClipboardHookUsage() {
  const {copy, isCopied} = useClipboard({announce: 'Link copied'});

  return (
    <Card width={420} padding={4}>
      <VStack gap={3}>
        <Text type="body" weight="bold">
          Share
        </Text>
        <HStack gap={2} vAlign="end">
          <StackItem size="fill">
            <TextInput label="Invite link" value={INVITE_LINK} isReadOnly />
          </StackItem>
          <Button
            label={isCopied ? 'Copied' : 'Copy'}
            onClick={() => void copy(INVITE_LINK)}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
