// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Layout, LayoutContent} from '@curialy/ui';
import {Text} from '@curialy/ui';

export default function Page() {
  return (
    <Layout
      content={
        <LayoutContent>
          <Text type="large">New Page</Text>
        </LayoutContent>
      }
    />
  );
}
