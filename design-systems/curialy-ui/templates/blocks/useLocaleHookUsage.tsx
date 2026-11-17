// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Card} from '@curialy/ui/Card';
import {InternationalizationProvider, useLocale} from '@curialy/ui/i18n';
import {HStack, VStack} from '@curialy/ui/Layout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@curialy/ui/SegmentedControl';
import {Text} from '@curialy/ui/Text';

type Locale = 'en' | 'de-DE';

const ISSUED_ON = new Date(2026, 10, 2);
const AMOUNT_DUE = 1234.5;

function InvoiceSummary() {
  const locale = useLocale();
  const issuedOn = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(ISSUED_ON);
  const amountDue = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(AMOUNT_DUE);

  return (
    <VStack gap={1}>
      <HStack justify="between">
        <Text type="body" color="secondary">
          Issued
        </Text>
        <Text type="body">{issuedOn}</Text>
      </HStack>
      <HStack justify="between">
        <Text type="body" color="secondary">
          Amount due
        </Text>
        <Text type="body" weight="bold">
          {amountDue}
        </Text>
      </HStack>
    </VStack>
  );
}

export default function UseLocaleHookUsage() {
  const [locale, setLocale] = useState<Locale>('en');

  return (
    <InternationalizationProvider locale={locale}>
      <Card width={320} padding={4}>
        <VStack gap={3}>
          <SegmentedControl
            label="Language"
            value={locale}
            onChange={nextLocale => setLocale(nextLocale as Locale)}
            size="sm">
            <SegmentedControlItem value="en" label="English" />
            <SegmentedControlItem value="de-DE" label="German" />
          </SegmentedControl>
          <InvoiceSummary />
        </VStack>
      </Card>
    </InternationalizationProvider>
  );
}
