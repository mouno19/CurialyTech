// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {EmptyState} from '@curialy/ui/EmptyState';
import {Button} from '@curialy/ui/Button';
import {HStack} from '@curialy/ui/Layout';
import {Icon} from '@curialy/ui/Icon';
import {InboxIcon} from '@heroicons/react/24/outline';

export default function EmptyStateCompact() {
  return (
    <EmptyState
      icon={<Icon icon={InboxIcon} size="lg" />}
      title="No notifications"
      description="You're all caught up. New notifications will appear here."
      actions={
        <HStack gap={2}>
          <Button label="Settings" variant="secondary" size="sm" />
          <Button label="Refresh" variant="primary" size="sm" />
        </HStack>
      }
      isCompact
    />
  );
}
