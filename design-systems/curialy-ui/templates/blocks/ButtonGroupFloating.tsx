// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ButtonGroup} from '@curialy/ui/ButtonGroup';
import {Button} from '@curialy/ui/Button';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ButtonGroupFloating() {
  return (
    <Stack direction="vertical" gap={3} hAlign="start">
      <Text type="supporting" color="secondary">
        The whole group shares one raised surface — a floating action bar
      </Text>
      <ButtonGroup label="Zoom controls" elevation="med">
        <Button label="Zoom out" />
        <Button label="Reset" />
        <Button label="Zoom in" />
      </ButtonGroup>
    </Stack>
  );
}
