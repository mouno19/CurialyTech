// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Dialog, DialogHeader} from '@curialy/ui/Dialog';
import {Layout, LayoutContent} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function DialogHeaderBasic() {
  return (
    <Dialog isOpen isInline onOpenChange={() => {}}>
      <Layout
        header={
          <DialogHeader
            title="Invite teammates"
            subtitle="Send invitations to join your workspace"
            onOpenChange={() => {}}
          />
        }
        content={
          <LayoutContent>
            <Text type="body" color="secondary">
              Dialog body content goes here.
            </Text>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
