// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {TopNav, TopNavHeading} from '@curialy/ui/TopNav';
import {NavIcon} from '@curialy/ui/NavIcon';
import {Icon} from '@curialy/ui/Icon';

export default function TopNavHeadingBasic() {
  return (
    <TopNav
      label="Product navigation"
      heading={
        <TopNavHeading
          heading="Acme Platform"
          logo={<NavIcon icon={<Icon icon="viewColumns" />} />}
          headingHref="/"
        />
      }
    />
  );
}
