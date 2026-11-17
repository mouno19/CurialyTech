// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import {PlusIcon} from '@heroicons/react/24/outline';

const VARIANTS = [
  {variant: 'primary' as const, label: 'Primary'},
  {variant: 'secondary' as const, label: 'Secondary'},
  {variant: 'ghost' as const, label: 'Ghost'},
  {variant: 'destructive' as const, label: 'Destructive'},
];

export default function ButtonFloating() {
  return (
    <Stack direction="vertical" gap={4}>
      <Text type="supporting" color="secondary">
        Floating action buttons — raised above content with `elevation="med"`
      </Text>
      <Stack direction="horizontal" gap={3} vAlign="center">
        {VARIANTS.map(({variant, label}) => (
          <Button
            key={variant}
            label={label}
            variant={variant}
            icon={<Icon icon={PlusIcon} />}
            elevation="med"
          />
        ))}
      </Stack>
    </Stack>
  );
}
