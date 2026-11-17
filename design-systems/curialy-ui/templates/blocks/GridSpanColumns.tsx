// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Grid, GridSpan} from '@curialy/ui/Grid';
import {Card} from '@curialy/ui/Card';
import {Text} from '@curialy/ui/Text';

export default function GridSpanColumns() {
  return (
    <Grid columns={3} gap={3} width={400}>
      <GridSpan columns={2}>
        <Card height={80}>
          <Text type="body" color="secondary">
            Spans 2 columns
          </Text>
        </Card>
      </GridSpan>
      <Card height={80}>
        <Text type="body" color="secondary">
          1 col
        </Text>
      </Card>
      <Card height={80}>
        <Text type="body" color="secondary">
          1 col
        </Text>
      </Card>
      <GridSpan columns={2}>
        <Card height={80}>
          <Text type="body" color="secondary">
            Spans 2 columns
          </Text>
        </Card>
      </GridSpan>
    </Grid>
  );
}
