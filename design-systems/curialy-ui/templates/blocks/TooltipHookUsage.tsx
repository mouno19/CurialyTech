// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useTooltip} from '@curialy/ui/Tooltip';
import {Button} from '@curialy/ui/Button';
import {Center} from '@curialy/ui/Center';

export default function TooltipHookUsage() {
  const tooltip = useTooltip({
    placement: 'above',
    delay: 100,
  });

  return (
    <Center>
      <Button
        label="Using hook directly"
        ref={tooltip.ref}
        aria-describedby={tooltip.describedBy}
      />
      {tooltip.renderTooltip('Tooltip via hook')}
    </Center>
  );
}
