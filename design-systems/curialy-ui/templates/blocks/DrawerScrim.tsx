// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @input Separate controlled states for modal and non-modal drawers
 * @output A comparison of hasScrim's two presentations
 * @position Copyable Drawer example
 */

import {useState} from 'react';
import {Drawer, DrawerHeader} from '@curialy/ui/Drawer';
import {Button} from '@curialy/ui/Button';
import {Layout, LayoutContent} from '@curialy/ui/Layout';
import {HStack} from '@curialy/ui/Stack';
import {Text} from '@curialy/ui/Text';

export default function DrawerScrim() {
  const [openModal, setOpenModal] = useState(false);
  const [openPanel, setOpenPanel] = useState(false);

  return (
    <>
      <HStack gap={2}>
        <Button label="Open modal drawer" onClick={() => setOpenModal(true)} />
        <Button
          label="Open non-modal drawer"
          onClick={() => setOpenPanel(true)}
        />
      </HStack>
      <Drawer
        isOpen={openModal}
        onOpenChange={setOpenModal}
        label="Edit details">
        <Layout
          header={
            <DrawerHeader title="Edit details" onOpenChange={setOpenModal} />
          }
          content={
            <LayoutContent>
              <Text type="body">
                The scrim blocks the page behind this modal drawer.
              </Text>
            </LayoutContent>
          }
        />
      </Drawer>
      <Drawer
        isOpen={openPanel}
        onOpenChange={setOpenPanel}
        label="Inspector"
        hasScrim={false}>
        <Layout
          header={
            <DrawerHeader title="Inspector" onOpenChange={setOpenPanel} />
          }
          content={
            <LayoutContent>
              <Text type="body">
                The page behind this non-modal drawer stays interactive.
              </Text>
            </LayoutContent>
          }
        />
      </Drawer>
    </>
  );
}
