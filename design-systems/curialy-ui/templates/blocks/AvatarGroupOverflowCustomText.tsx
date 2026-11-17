// Copyright (c) Meta Platforms, Inc. and affiliates.
'use client';

import {Avatar} from '@curialy/ui/Avatar';
import {AvatarGroup, AvatarGroupOverflow} from '@curialy/ui/AvatarGroup';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const TEAM = [
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

export default function AvatarGroupOverflowCustomText() {
  return (
    <Stack direction="vertical" gap={3}>
      <Text type="supporting" color="secondary">
        Team members
      </Text>
      <AvatarGroup size="lg">
        {TEAM.map(member => (
          <Avatar key={member.name} name={member.name} />
        ))}
        <AvatarGroupOverflow count={12}>12+</AvatarGroupOverflow>
      </AvatarGroup>
    </Stack>
  );
}
