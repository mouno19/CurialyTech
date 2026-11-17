// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {TabList, Tab} from '@curialy/ui/TabList';
import {Badge} from '@curialy/ui/Badge';

export default function TabListTabsWithBadge() {
  const [value, setValue] = useState('inbox');
  return (
    <TabList value={value} onChange={setValue}>
      <Tab
        value="inbox"
        label="Inbox"
        endContent={<Badge variant="error" label="5" />}
      />
      <Tab value="sent" label="Sent" />
      <Tab
        value="drafts"
        label="Drafts"
        endContent={<Badge variant="neutral" label="2" />}
      />
    </TabList>
  );
}
