// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Dialog, DialogHeader} from '@curialy/ui/Dialog';
import {Layout, LayoutContent} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

// Remove isInline for production — dialogs should be modal.
export default function DialogShowcase() {
  return (
    <Dialog isOpen isInline onOpenChange={() => {}}>
      <Layout
        header={<DialogHeader title="Modal Title" onOpenChange={() => {}} />}
        content={
          <LayoutContent>
            <Text type="body">Dialog content goes here.</Text>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
