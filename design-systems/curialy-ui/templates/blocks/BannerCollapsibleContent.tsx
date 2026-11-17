// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Banner} from '@curialy/ui/Banner';
import {Button} from '@curialy/ui/Button';
import {List, ListItem} from '@curialy/ui/List';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function BannerCollapsibleContent() {
  return (
    <Banner
      status="warning"
      title="Configuration changes detected"
      description="Review the changes before they take effect."
      endContent={<Button label="Review" variant="secondary" size="sm" />}
      isDismissable
      collapsible={{defaultIsOpen: true}}>
      <Stack direction="vertical" gap={2}>
        <Text type="supporting" color="secondary">
          Changed settings:
        </Text>
        <List density="compact">
          <ListItem label="Authentication method updated" />
          <ListItem label="Rate limits modified" />
        </List>
      </Stack>
    </Banner>
  );
}
