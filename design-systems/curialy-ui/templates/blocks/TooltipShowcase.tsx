// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Tooltip} from '@curialy/ui/Tooltip';
import {Button} from '@curialy/ui/Button';

export default function TooltipShowcase() {
  return (
    <Tooltip content="This is a helpful tooltip" placement="above">
      <Button label="Hover me" />
    </Tooltip>
  );
}
