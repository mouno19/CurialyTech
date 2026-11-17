// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Badge} from '@curialy/ui/Badge';
import {Icon} from '@curialy/ui/Icon';
import {Item} from '@curialy/ui/Item';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ItemWithMetadata() {
  return (
    <Stack gap={0}>
      <Item
        startContent={<Icon icon="check" size="sm" color="success" />}
        label="Build passed"
        description="Production deploy completed"
        endContent={<Text color="secondary">2m ago</Text>}
      />
      <Item
        startContent={<Icon icon="warning" size="sm" color="warning" />}
        label="High memory usage"
        description="Worker pool is above the warning threshold"
        endContent={<Badge label="Warning" variant="warning" />}
        isHighlighted
      />
      <Item
        startContent={<Icon icon="error" size="sm" color="error" />}
        label="Sync failed"
        description="Retry after checking service credentials"
        endContent={<Badge label="Action" variant="error" />}
        isSelected
      />
    </Stack>
  );
}
