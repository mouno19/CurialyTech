// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {OverflowList} from '@curialy/ui/OverflowList';
import {Button} from '@curialy/ui/Button';
import {DropdownMenu} from '@curialy/ui/DropdownMenu';
import {Card} from '@curialy/ui/Card';

const actions = ['Save', 'Edit', 'Duplicate', 'Share', 'Archive', 'Delete'];

export default function OverflowListOverflowDropdownActions() {
  return (
    <Card
      padding={2}
      style={{
        resize: 'horizontal',
        overflow: 'hidden',
        minWidth: 100,
        width: 350,
        maxWidth: '100%',
      }}>
      <OverflowList
        gap={2}
        overflowRenderer={overflowItems => (
          <DropdownMenu
            button={{
              label: `+${overflowItems.length}`,
              variant: 'ghost',
              size: 'sm',
            }}
            items={overflowItems.map(({index}) => ({
              label: actions[index],
              onClick: () => {},
            }))}
          />
        )}>
        <Button label="Save" size="sm" variant="primary" />
        <Button label="Edit" size="sm" />
        <Button label="Duplicate" size="sm" />
        <Button label="Share" size="sm" />
        <Button label="Archive" size="sm" />
        <Button label="Delete" size="sm" variant="destructive" />
      </OverflowList>
    </Card>
  );
}
