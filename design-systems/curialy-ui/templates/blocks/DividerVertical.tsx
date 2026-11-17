// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import type {CSSProperties} from 'react';
import {Divider} from '@curialy/ui/Divider';
import {Card} from '@curialy/ui/Card';
import {Section} from '@curialy/ui/Section';
import {HStack, VStack, StackItem} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const dividerFill: CSSProperties = {
  alignSelf: 'stretch',
  height: 'auto',
};

export default function DividerVertical() {
  return (
    <Section variant="transparent" width="100%">
      <Card>
        <HStack gap={4} align="stretch">
          <StackItem size="fill">
            <VStack gap={1}>
              <Text type="label">Revenue</Text>
              <Text type="label">$24,500</Text>
              <Text type="supporting" color="secondary">
                +12% vs last month
              </Text>
            </VStack>
          </StackItem>
          <Divider orientation="vertical" style={dividerFill} />
          <StackItem size="fill">
            <VStack gap={1}>
              <Text type="label">Users</Text>
              <Text type="label">1,240</Text>
              <Text type="supporting" color="secondary">
                +8% vs last month
              </Text>
            </VStack>
          </StackItem>
          <Divider orientation="vertical" style={dividerFill} />
          <StackItem size="fill">
            <VStack gap={1}>
              <Text type="label">Conversion</Text>
              <Text type="label">3.2%</Text>
              <Text type="supporting" color="secondary">
                -0.5% vs last month
              </Text>
            </VStack>
          </StackItem>
        </HStack>
      </Card>
    </Section>
  );
}
