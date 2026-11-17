// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {OverflowList} from '@curialy/ui/OverflowList';
import {Button} from '@curialy/ui/Button';
import {DropdownMenu} from '@curialy/ui/DropdownMenu';
import {Card} from '@curialy/ui/Card';
import {Center} from '@curialy/ui/Center';

const actions = ['Save', 'Edit', 'Duplicate', 'Share', 'Archive', 'Delete'];

export default function OverflowListCappedToolbar() {
  return (
    <Center width={420}>
      <Card padding={2}>
        <OverflowList
          gap={2}
          maxVisibleItems={3}
          overflowRenderer={overflowItems => (
            <DropdownMenu
              button={{
                label: `+${overflowItems.length}`,
                variant: 'ghost',
                size: 'sm',
              }}
              items={overflowItems.map(({index}) => ({
                label: actions[index],
              }))}
            />
          )}>
          {actions.map(action => (
            <Button key={action} label={action} size="sm" />
          ))}
        </OverflowList>
      </Card>
    </Center>
  );
}
