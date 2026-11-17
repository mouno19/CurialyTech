// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {InfoTip} from '@curialy/ui/InfoTip';
import {HStack, VStack} from '@curialy/ui/Stack';
import {Text} from '@curialy/ui/Text';

const metrics = [
  {
    name: 'Active users',
    value: '48,210',
    definition: 'People who opened the app at least once in the last 28 days.',
  },
  {
    name: 'Retention',
    value: '62%',
    definition: 'Share of last month’s active users who returned this month.',
  },
  {
    name: 'Median session',
    value: '6m 40s',
    definition: 'Half of all sessions this week were shorter than this.',
  },
];

export default function InfoTipMetricDefinitions() {
  return (
    <HStack gap={6} wrap="wrap">
      {metrics.map(metric => (
        <VStack key={metric.name} gap={1}>
          <HStack gap={1} align="center">
            <Text type="label" color="secondary">
              {metric.name}
            </Text>
            <InfoTip
              content={metric.definition}
              label={`About ${metric.name.toLowerCase()}`}
            />
          </HStack>
          <Text type="large">{metric.value}</Text>
        </VStack>
      ))}
    </HStack>
  );
}
