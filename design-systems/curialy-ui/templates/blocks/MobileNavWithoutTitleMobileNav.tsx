// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {MobileNav} from '@curialy/ui/MobileNav';
import {SideNavSection, SideNavItem} from '@curialy/ui/SideNav';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {HomeIcon, FolderIcon} from '@heroicons/react/24/outline';

export default function MobileNavWithoutTitleMobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button
        label="Open Navigation"
        icon={<Icon icon="menu" color="inherit" />}
        variant="ghost"
        onClick={() => setIsOpen(true)}
        isIconOnly
      />
      <MobileNav isOpen={isOpen} onOpenChange={open => setIsOpen(open)}>
        <SideNavSection title="Main">
          <SideNavItem
            label="Dashboard"
            icon={HomeIcon}
            isSelected
            href="/dashboard"
          />
          <SideNavItem label="Projects" icon={FolderIcon} href="/projects" />
        </SideNavSection>
      </MobileNav>
    </>
  );
}
