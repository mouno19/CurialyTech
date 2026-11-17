// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Spinner} from '@curialy/ui/Spinner';
import {Text} from '@curialy/ui/Text';
import {HStack, VStack} from '@curialy/ui/Layout';

export default function SpinnerWithLabel() {
  return (
    <HStack gap={8} vAlign="start">
      <Spinner size="lg" label="Loading..." />
      <Spinner
        size="lg"
        label={
          <VStack gap={0} hAlign="center">
            <Text type="body" weight="bold">
              Fetching data
            </Text>
            <Text type="supporting" color="secondary">
              This may take a moment
            </Text>
          </VStack>
        }
        aria-label="Fetching data"
      />
    </HStack>
  );
}
