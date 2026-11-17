// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {EmptyState} from '@curialy/ui/EmptyState';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {MagnifyingGlassIcon} from '@heroicons/react/24/outline';

export default function EmptyStateShowcase() {
  return (
    <EmptyState
      icon={<Icon icon={MagnifyingGlassIcon} size="lg" />}
      title="No results found"
      description="Try adjusting your search or filters to find what you need."
      actions={<Button label="Clear filters" variant="secondary" />}
    />
  );
}
