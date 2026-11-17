// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {ToggleButton, ToggleButtonGroup} from '@curialy/ui/ToggleButton';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ToggleButtonGroupVertical() {
  const [view, setView] = useState<string | null>('grid');
  const [filters, setFilters] = useState<string[]>(['active']);

  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Text type="label" color="secondary">
          Single select
        </Text>
        <ToggleButtonGroup
          orientation="vertical"
          value={view}
          onChange={setView}
          label="View mode">
          <ToggleButton value="list" label="List" />
          <ToggleButton value="grid" label="Grid" />
          <ToggleButton value="board" label="Board" />
        </ToggleButtonGroup>
      </VStack>
      <VStack gap={1}>
        <Text type="label" color="secondary">
          Multi select
        </Text>
        <ToggleButtonGroup
          orientation="vertical"
          type="multiple"
          value={filters}
          onChange={setFilters}
          label="Status filters">
          <ToggleButton value="active" label="Active" />
          <ToggleButton value="pending" label="Pending" />
          <ToggleButton value="closed" label="Closed" />
        </ToggleButtonGroup>
      </VStack>
    </VStack>
  );
}
