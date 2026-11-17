// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useLayer} from '@curialy/ui/Layer';
import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {Center} from '@curialy/ui/Center';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function LayerHookUsage() {
  const layer = useLayer({mode: 'context', lightDismiss: true});

  return (
    <Center height={220}>
      <Button
        label={layer.isOpen ? 'Hide layer' : 'Show layer'}
        ref={layer.ref}
        onClick={layer.isOpen ? layer.hide : layer.show}
      />
      {layer.render(
        <Card padding={3}>
          <VStack gap={1}>
            <Text type="body" weight="bold">
              Anchored content
            </Text>
            <Text type="body" color="secondary">
              useLayer provides positioning; you own semantics and surface.
            </Text>
          </VStack>
        </Card>,
        {placement: 'below', alignment: 'center'},
      )}
    </Center>
  );
}
