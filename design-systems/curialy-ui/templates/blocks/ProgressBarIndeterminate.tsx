// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ProgressBar} from '@curialy/ui/ProgressBar';

export default function ProgressBarIndeterminate() {
  return (
    <ProgressBar isIndeterminate label="Loading..." style={{width: 300}} />
  );
}
