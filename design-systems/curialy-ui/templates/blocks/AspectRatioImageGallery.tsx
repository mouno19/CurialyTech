// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {AspectRatio} from '@curialy/ui/AspectRatio';
import {Center} from '@curialy/ui/Center';
import {Grid} from '@curialy/ui/Grid';

const images = [
  {id: 1, alt: 'Mountain landscape'},
  {id: 2, alt: 'Ocean sunset'},
  {id: 3, alt: 'Forest trail'},
  {id: 4, alt: 'City skyline'},
  {id: 5, alt: 'Desert dunes'},
  {id: 6, alt: 'Snowy peaks'},
];

export default function AspectRatioImageGallery() {
  // Anchor a definite width so the grid renders in shrink-to-fit contexts
  // (e.g. the docsite example preview, which wraps blocks in a
  // `min-width: fit-content` container). Without a fixed-width ancestor,
  // the `width="100%"` grid collapses to zero — AspectRatio positions its
  // child absolutely, so it has no intrinsic width to size the grid from.
  return (
    <Center width={600}>
      <Grid columns={3} gap={4} width="100%">
        {images.map(({id, alt}) => (
          <AspectRatio key={id} ratio={4 / 3} fit="cover">
            <img
              src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E"
              alt={alt}
              style={{borderRadius: 'var(--radius-element)'}}
            />
          </AspectRatio>
        ))}
      </Grid>
    </Center>
  );
}
