// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @input Controlled open state for a modal Drawer
 * @output A DrawerHeader with a subtitle, a status badge in its end slot, and a close button
 * @position Copyable DrawerHeader example
 */

import {useState} from 'react';
import {Drawer, DrawerHeader} from '@curialy/ui/Drawer';
import {Badge} from '@curialy/ui/Badge';
import {Button} from '@curialy/ui/Button';
import {Layout, LayoutContent} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function DrawerHeaderSubtitleEndContent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button label="Open host details" onClick={() => setIsOpen(true)} />
      <Drawer
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label="web-prod-04"
        width={360}>
        <Layout
          header={
            <DrawerHeader
              title="web-prod-04"
              subtitle="us-east-1"
              endContent={<Badge label="Healthy" variant="success" />}
              onOpenChange={setIsOpen}
            />
          }
          content={
            <LayoutContent>
              <Text type="body">
                All 6 instances are passing readiness checks.
              </Text>
            </LayoutContent>
          }
        />
      </Drawer>
    </>
  );
}
