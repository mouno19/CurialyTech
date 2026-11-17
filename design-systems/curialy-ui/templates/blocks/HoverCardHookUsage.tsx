// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useHoverCard} from '@curialy/ui/HoverCard';
import {Button} from '@curialy/ui/Button';
import {Center} from '@curialy/ui/Center';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function HoverCardHookUsage() {
  const hoverCard = useHoverCard({
    placement: 'below',
    delay: 100,
    isDefaultOpen: true,
    label: 'Alex Morgan',
  });

  return (
    <Center height={220}>
      <Button
        label="Hover profile"
        ref={hoverCard.ref}
        aria-haspopup="dialog"
        aria-controls={hoverCard.isOpen ? hoverCard.id : undefined}
        aria-expanded={hoverCard.isOpen}
      />
      {hoverCard.renderHoverCard(
        <VStack gap={1}>
          <Text type="body" weight="bold">
            Alex Morgan
          </Text>
          <Text type="body" color="secondary">
            Staff designer · Product systems
          </Text>
          <Text type="body" color="secondary">
            Owns interaction patterns for overlays and navigation.
          </Text>
        </VStack>,
        {placement: 'below', alignment: 'center'},
      )}
    </Center>
  );
}
