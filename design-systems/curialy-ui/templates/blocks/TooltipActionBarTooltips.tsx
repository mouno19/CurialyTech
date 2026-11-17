// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Tooltip} from '@curialy/ui/Tooltip';
import {Button} from '@curialy/ui/Button';
import {HStack} from '@curialy/ui/Layout';
import {Center} from '@curialy/ui/Center';

export default function TooltipActionBarTooltips() {
  return (
    <Center>
      <HStack gap={4}>
        <Tooltip content="Save your changes" placement="above">
          <Button label="Save" />
        </Tooltip>
        <Tooltip content="Discard changes" placement="above">
          <Button label="Cancel" />
        </Tooltip>
        <Tooltip content="Delete permanently" placement="above">
          <Button label="Delete" variant="destructive" />
        </Tooltip>
      </HStack>
    </Center>
  );
}
