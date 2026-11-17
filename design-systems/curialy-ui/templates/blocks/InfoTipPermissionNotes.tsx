// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {InfoTip} from '@curialy/ui/InfoTip';
import {HStack, VStack} from '@curialy/ui/Stack';
import {Text} from '@curialy/ui/Text';

const fields = [
  {
    name: 'Owner',
    value: 'Design Systems',
    note: 'Only admins can change the owner.',
  },
  {
    name: 'Visibility',
    value: 'Everyone in the workspace',
    note: 'Editors can change this field; viewers cannot.',
  },
];

export default function InfoTipPermissionNotes() {
  return (
    <VStack gap={4}>
      {fields.map(field => (
        <VStack key={field.name} gap={1}>
          <HStack gap={1} align="center">
            <Text type="label">{field.name}</Text>
            <InfoTip
              content={field.note}
              label={`Who can change ${field.name.toLowerCase()}`}
            />
          </HStack>
          <Text type="body" color="secondary">
            {field.value}
          </Text>
        </VStack>
      ))}
    </VStack>
  );
}
