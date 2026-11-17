// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {TopNav, TopNavHeading, TopNavItem} from '@curialy/ui/TopNav';
import {NavIcon} from '@curialy/ui/NavIcon';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {CubeIcon, UserCircleIcon} from '@heroicons/react/24/outline';

export default function TopNavCenteredNavigation() {
  return (
    <TopNav
      label="Main navigation"
      heading={
        <TopNavHeading
          heading="My App"
          logo={<NavIcon icon={<Icon icon={CubeIcon} size="sm" />} />}
          headingHref="#"
        />
      }
      centerContent={
        <>
          <TopNavItem label="Home" href="#" isSelected />
          <TopNavItem label="Products" href="#" />
          <TopNavItem label="About" href="#" />
        </>
      }
      endContent={
        <>
          <Button
            label="Search"
            variant="ghost"
            icon={<Icon icon="search" color="inherit" />}
            isIconOnly
          />
          <Button
            label="Profile"
            variant="ghost"
            icon={<UserCircleIcon />}
            isIconOnly
          />
        </>
      }
    />
  );
}
