// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @input Controlled open state for a modal Drawer
 * @output A single-trigger drawer with a scrim and a DrawerHeader close button
 * @position Drawer's docsite showcase and copyable CLI block
 */

import {useState} from 'react';
import {Drawer, DrawerHeader} from '@curialy/ui/Drawer';
import {Button} from '@curialy/ui/Button';
import {Layout, LayoutContent} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function DrawerShowcase() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button label="Open drawer" onClick={() => setIsOpen(true)} />
      <Drawer
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label="Details"
        width={360}>
        <Layout
          header={<DrawerHeader title="Details" onOpenChange={setIsOpen} />}
          content={
            <LayoutContent>
              <Text type="body">
                Close with Escape, the scrim, or the close button.
              </Text>
            </LayoutContent>
          }
        />
      </Drawer>
    </>
  );
}
