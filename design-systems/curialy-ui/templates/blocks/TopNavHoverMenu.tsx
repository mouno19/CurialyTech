// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {
  TopNav,
  TopNavHeading,
  TopNavItem,
  TopNavMenu,
} from '@curialy/ui/TopNav';
import {NavIcon} from '@curialy/ui/NavIcon';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {
  CubeIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  BoltIcon,
  CodeBracketIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

export default function TopNavHoverMenu() {
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
      startContent={
        <>
          <TopNavItem label="Home" href="#" isSelected />
          <TopNavMenu
            label="Products"
            items={[
              {
                title: 'Analytics',
                description: 'Track and analyze user behavior',
                icon: <ChartBarIcon />,
                href: '#analytics',
              },
              {
                title: 'Security',
                description: 'Enterprise-grade protection',
                icon: <ShieldCheckIcon />,
                href: '#security',
              },
              {
                title: 'Automation',
                description: 'Streamline your workflows',
                icon: <BoltIcon />,
                href: '#automation',
              },
              {
                title: 'Developer Tools',
                description: 'APIs, SDKs, and CLI tools',
                icon: <CodeBracketIcon />,
                href: '#dev-tools',
              },
            ]}
          />
          <TopNavItem label="Pricing" href="#" />
        </>
      }
      endContent={
        <Button
          label="Profile"
          variant="ghost"
          icon={<UserCircleIcon />}
          isIconOnly
        />
      }
    />
  );
}
