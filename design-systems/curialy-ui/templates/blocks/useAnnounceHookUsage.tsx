// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useEffect, useRef, useState} from 'react';
import {Card} from '@curialy/ui/Card';
import {useAnnounce} from '@curialy/ui/hooks';
import {VStack} from '@curialy/ui/Layout';
import {List, ListItem} from '@curialy/ui/List';
import {Text} from '@curialy/ui/Text';
import {TextInput} from '@curialy/ui/TextInput';

const PRODUCTS = [
  'Desk lamp',
  'Desk organizer',
  'Standing desk',
  'Office chair',
  'Chair mat',
  'Monitor arm',
  'Monitor stand',
  'Keyboard tray',
];

const ANNOUNCE_DELAY_MS = 500;

function filterProducts(query: string): string[] {
  const needle = query.trim().toLowerCase();
  return PRODUCTS.filter(product => product.toLowerCase().includes(needle));
}

export default function UseAnnounceHookUsage() {
  const announce = useAnnounce({hasReplace: true});
  const [query, setQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matches = filterProducts(query);
  const count = matches.length;

  const handleChange = (value: string) => {
    setQuery(value);
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (value === '') {
      return;
    }
    const nextCount = filterProducts(value).length;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      announce(
        nextCount === 0
          ? 'No results'
          : `${nextCount} ${nextCount === 1 ? 'result' : 'results'}`,
      );
    }, ANNOUNCE_DELAY_MS);
  };

  // A count still pending at unmount would be spoken for a filter that is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <Card width={360} padding={4}>
      <VStack gap={3}>
        <TextInput
          label="Filter products"
          value={query}
          onChange={handleChange}
          hasClear
        />
        {count === 0 ? (
          <Text type="body" color="secondary">
            No results
          </Text>
        ) : (
          <List density="compact">
            {matches.map(product => (
              <ListItem key={product} label={product} />
            ))}
          </List>
        )}
      </VStack>
    </Card>
  );
}
