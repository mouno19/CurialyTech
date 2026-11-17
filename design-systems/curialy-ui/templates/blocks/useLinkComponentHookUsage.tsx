// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {createContext, use, useState, type AnchorHTMLAttributes} from 'react';
import {Card} from '@curialy/ui/Card';
import {VStack} from '@curialy/ui/Layout';
import {
  LinkProvider,
  useLinkComponent,
  type LinkComponentType,
} from '@curialy/ui/Link';
import {Text} from '@curialy/ui/Text';

const NavigateContext = createContext<(to: string) => void>(() => {});

function RouterLink({
  to,
  href: _href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {to: string}) {
  const navigate = use(NavigateContext);
  return (
    <a
      {...props}
      href={to}
      onClick={event => {
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}

function ArticleCard({
  title,
  href,
  resolvedBy,
  linkAs,
}: {
  title: string;
  href: string;
  resolvedBy: string;
  linkAs?: LinkComponentType;
}) {
  const LinkComponent = useLinkComponent(linkAs);
  return (
    <Card padding={3}>
      <VStack gap={1}>
        <Text type="body" weight="bold">
          <LinkComponent href={href}>{title}</LinkComponent>
        </Text>
        <Text type="supporting" color="secondary">
          {resolvedBy}
        </Text>
      </VStack>
    </Card>
  );
}

export default function UseLinkComponentHookUsage() {
  const [route, setRoute] = useState('/');

  return (
    <VStack gap={3}>
      <Text type="body">Router location: {route}</Text>
      <NavigateContext value={setRoute}>
        <LinkProvider component={RouterLink}>
          <ArticleCard
            title="Getting started"
            href="/articles/getting-started"
            resolvedBy="LinkProvider: the router's link, no page load"
          />
          <ArticleCard
            title="Style guide (PDF)"
            href="#style-guide"
            resolvedBy='as="a": a native anchor, even inside the provider'
            linkAs="a"
          />
        </LinkProvider>
      </NavigateContext>
      <ArticleCard
        title="Release notes"
        href="#release-notes"
        resolvedBy="Outside the provider: the app's LinkProvider, or a native anchor"
      />
    </VStack>
  );
}
