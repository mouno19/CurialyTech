// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Dialog, DialogHeader} from '@curialy/ui/Dialog';
import {Layout, LayoutContent, Card} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function DialogHeaderShowcase() {
  return (
    <Dialog isOpen isInline onOpenChange={() => {}}>
      <Layout
        header={
          <DialogHeader
            title="Edit Profile"
            subtitle="Update your personal information"
            onOpenChange={() => {}}
          />
        }
        content={
          <LayoutContent>
            <Card variant="muted">
              <Text type="body" color="secondary">
                Dialog body content goes here.
              </Text>
            </Card>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
