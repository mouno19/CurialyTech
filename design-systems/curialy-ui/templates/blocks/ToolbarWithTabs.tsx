// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type CSSProperties} from 'react';
import {Toolbar} from '@curialy/ui/Toolbar';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {TabList, Tab} from '@curialy/ui/TabList';
import {Card} from '@curialy/ui/Card';
import {Section} from '@curialy/ui/Section';
import {PlusIcon} from '@heroicons/react/24/outline';

const card: CSSProperties = {
  width: '100%',
  maxWidth: 500,
  height: '100%',
  marginTop: 200,
};

export default function ToolbarWithTabs() {
  const [tab, setTab] = useState('overview');
  return (
    <Card style={card}>
      <Toolbar
        label="Section navigation"
        dividers={['bottom']}
        startContent={
          <TabList value={tab} onChange={setTab}>
            <Tab value="overview" label="Overview" />
            <Tab value="analytics" label="Analytics" />
            <Tab value="settings" label="Settings" />
          </TabList>
        }
        endContent={
          <Button label="New item" icon={<Icon icon={PlusIcon} />} isIconOnly />
        }
      />
      <Section />
    </Card>
  );
}
