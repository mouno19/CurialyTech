// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Link} from '@curialy/ui/Link';
import {Text} from '@curialy/ui/Text';

export default function LinkInlineLink() {
  return (
    <Text type="body">
      Read the <Link href="#">documentation</Link> for more information about
      using Curialy UI components.
    </Text>
  );
}
