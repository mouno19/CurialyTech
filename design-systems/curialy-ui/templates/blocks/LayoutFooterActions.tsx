// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {
  Layout,
  LayoutContent,
  LayoutFooter,
  Card,
  HStack,
} from '@curialy/ui/Layout';
import {Center} from '@curialy/ui/Center';
import {Button} from '@curialy/ui/Button';

export default function LayoutFooterActions() {
  return (
    <Center width={400}>
      <Layout
        style={{width: '100%'}}
        height="fill"
        content={
          <LayoutContent>
            <Card variant="muted" />
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary">
                Cancel
              </Button>
              <Button label="Save" variant="primary">
                Save
              </Button>
            </HStack>
          </LayoutFooter>
        }
      />
    </Center>
  );
}
