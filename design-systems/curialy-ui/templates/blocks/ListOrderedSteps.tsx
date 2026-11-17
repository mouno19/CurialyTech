// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {List, ListItem} from '@curialy/ui/List';

export default function ListOrderedSteps() {
  return (
    <List listStyle="decimal">
      <ListItem
        label="Install the package"
        description="npm install @curialy/ui"
      />
      <ListItem
        label="Import components"
        description="import { List } from '@curialy/ui'"
      />
      <ListItem
        label="Start building"
        description="Use components in your app"
      />
    </List>
  );
}
