// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {AspectRatio} from '@curialy/ui/AspectRatio';
import {Skeleton} from '@curialy/ui/Skeleton';
import {Center} from '@curialy/ui/Center';

export default function AspectRatioWithSkeleton() {
  return (
    <Center width={600}>
      <AspectRatio ratio={16 / 9}>
        <Skeleton width="100%" height="100%" />
      </AspectRatio>
    </Center>
  );
}
