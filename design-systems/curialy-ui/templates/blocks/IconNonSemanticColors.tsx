// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Icon} from '@curialy/ui/Icon';
import {HStack, VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const colors = [
  'blue',
  'red',
  'green',
  'gray',
  'cyan',
  'teal',
  'yellow',
  'orange',
  'pink',
  'purple',
] as const;

export default function IconNonSemanticColors() {
  return (
    <HStack gap={4} wrap="wrap">
      {colors.map(color => (
        <VStack key={color} gap={1} hAlign="center">
          <Icon icon="search" color={color} />
          <Text type="supporting">{color}</Text>
        </VStack>
      ))}
    </HStack>
  );
}
