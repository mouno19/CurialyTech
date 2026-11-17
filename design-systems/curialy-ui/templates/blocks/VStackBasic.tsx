// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {VStack} from '@curialy/ui/Layout';
import {Text, Heading} from '@curialy/ui/Text';

export default function VStackBasic() {
  return (
    <VStack gap={3}>
      <Heading level={5}>Weekly Report</Heading>
      <Text type="body" color="secondary">
        VStack arranges its children in a vertical column.
      </Text>
      <Text type="body" color="secondary">
        The gap prop controls the spacing between each item.
      </Text>
    </VStack>
  );
}
