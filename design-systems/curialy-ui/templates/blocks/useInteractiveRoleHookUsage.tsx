// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useInteractiveRole} from '@curialy/ui/hooks';
import {Link} from '@curialy/ui/Link';
import {Popover} from '@curialy/ui/Popover';
import {Card} from '@curialy/ui/Card';
import {Text} from '@curialy/ui/Text';
import {VStack} from '@curialy/ui/Layout';

// A polymorphic Tile: the hook alone decides what it renders as — href wins,
// then onClick, then a trigger context (Popover), then inert.
function Tile({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const role = useInteractiveRole({href, onClick});
  const body = (
    <Card padding={3} width={200}>
      <Text type="body">{children}</Text>
    </Card>
  );
  switch (role) {
    case 'link':
      return <Link href={href}>{body}</Link>;
    case 'button':
      return <button onClick={onClick}>{body}</button>;
    default:
      return body;
  }
}

export default function UseInteractiveRoleHookUsage() {
  return (
    <VStack gap={3} hAlign="center" style={{width: '100%'}}>
      <Tile href="https://example.com/docs">Renders as a link</Tile>
      <Tile onClick={() => {}}>Renders as a button</Tile>
      <Popover
        label="Tile details"
        content={
          <Card padding={3}>
            <Text type="body">Opened through the tile's context role</Text>
          </Card>
        }>
        <Tile>Trigger via context</Tile>
      </Popover>
      <Tile>Plain content</Tile>
    </VStack>
  );
}
