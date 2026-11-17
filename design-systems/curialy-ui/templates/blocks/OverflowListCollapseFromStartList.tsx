// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {OverflowList} from '@curialy/ui/OverflowList';
import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {Center} from '@curialy/ui/Center';

export default function OverflowListCollapseFromStartList() {
  return (
    <Center width={300}>
      <Card padding={2}>
        <OverflowList
          gap={2}
          collapseFrom="start"
          overflowRenderer={overflowItems => (
            <Button
              label={`+${overflowItems.length} more`}
              variant="ghost"
              size="sm"
            />
          )}>
          <Button label="Step 1" size="sm" />
          <Button label="Step 2" size="sm" />
          <Button label="Step 3" size="sm" />
          <Button label="Step 4" size="sm" />
          <Button label="Step 5" size="sm" />
        </OverflowList>
      </Card>
    </Center>
  );
}
