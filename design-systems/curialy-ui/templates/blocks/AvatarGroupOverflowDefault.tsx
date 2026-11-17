// Copyright (c) Meta Platforms, Inc. and affiliates.
'use client';

import {Avatar} from '@curialy/ui/Avatar';
import {AvatarGroup, AvatarGroupOverflow} from '@curialy/ui/AvatarGroup';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const REVIEWERS = [
  {
    name: 'Alex Daniels',
  },
  {
    name: 'Ann Smith',
  },
  {
    name: 'Carol Davis',
  },
];

export default function AvatarGroupOverflowDefault() {
  return (
    <Stack direction="vertical" gap={3}>
      <Text type="supporting" color="secondary">
        Reviewers
      </Text>
      <AvatarGroup size="lg">
        {REVIEWERS.map(reviewer => (
          <Avatar key={reviewer.name} name={reviewer.name} />
        ))}
        <AvatarGroupOverflow count={2} />
      </AvatarGroup>
    </Stack>
  );
}
