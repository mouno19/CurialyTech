// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {usePopover} from '@curialy/ui/Popover';
import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {Center} from '@curialy/ui/Center';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function PopoverHookUsage() {
  const popover = usePopover({dialogLabel: 'Quick actions'});

  return (
    <Center height={240}>
      <Button
        label="Open actions"
        ref={popover.triggerRef}
        onClick={popover.toggle}
        {...popover.triggerProps}
      />
      {popover.render(
        <Card width={220} padding={3} variant="transparent">
          <VStack gap={2}>
            <Text type="body" weight="bold">
              Quick actions
            </Text>
            <Button label="Create task" size="sm" />
            <Button label="Share report" variant="secondary" size="sm" />
          </VStack>
        </Card>,
        {placement: 'below', alignment: 'center'},
      )}
    </Center>
  );
}
