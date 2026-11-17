// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {DropdownMenu} from '@curialy/ui/DropdownMenu';
import {Icon} from '@curialy/ui/Icon';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import {EllipsisHorizontalIcon} from '@heroicons/react/24/outline';

export default function DropdownMenuNoChevron() {
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <VStack gap={3}>
      <DropdownMenu
        button={{
          label: 'More actions',
          icon: <Icon icon={EllipsisHorizontalIcon} />,
          variant: 'ghost',
          isIconOnly: true,
        }}
        hasChevron={false}
        items={[
          {label: 'Copy link', onClick: () => setLastAction('Copy link')},
          {label: 'Download', onClick: () => setLastAction('Download')},
          {label: 'Print', onClick: () => setLastAction('Print')},
          {type: 'divider'},
          {label: 'Report', onClick: () => setLastAction('Report')},
        ]}
      />
      {lastAction && (
        <Text type="supporting" color="secondary">
          Last action: {lastAction}
        </Text>
      )}
    </VStack>
  );
}
