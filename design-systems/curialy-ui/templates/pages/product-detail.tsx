// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {VStack, HStack, Layout, LayoutContent} from '@curialy/ui/Layout';
import {Center} from '@curialy/ui/Center';
import {Grid} from '@curialy/ui/Grid';
import {Text, Heading} from '@curialy/ui/Text';
import {Button} from '@curialy/ui/Button';
import {NumberInput} from '@curialy/ui/NumberInput';
import {Icon} from '@curialy/ui/Icon';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@curialy/ui/SegmentedControl';
import {Badge} from '@curialy/ui/Badge';
import {Divider} from '@curialy/ui/Divider';
import {Collapsible, CollapsibleGroup} from '@curialy/ui/Collapsible';
import {AspectRatio} from '@curialy/ui/AspectRatio';
import {SelectableCard} from '@curialy/ui/SelectableCard';
import type {CSSProperties} from 'react';

// Custom CSS here is limited to what Curialy UI components can't express today:
// - image fill + corner radius (no Image primitive — #2582)
// - the sticky info column (no sticky prop on Curialy UI layout primitives — #2613)
// Keeps the info column in view while the gallery scrolls. No sticky prop on
// Curialy UI layout primitives.
const stickyInfo: CSSProperties = {
  position: 'sticky',
  top: 'var(--spacing-8)',
  alignSelf: 'start',
};
// Fills the AspectRatio box + rounds corners. No objectFit/radius props on
// AspectRatio (#2582).
const heroImage: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: 'var(--radius-container)',
};
// Fills the thumbnail card. Corner radius + selection ring come from
// SelectableCard; the image only needs to fill and cover (#2582).
const thumbImage: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

import {MinusIcon, PlusIcon, StarIcon} from '@heroicons/react/24/outline';
import {StarIcon as StarIconSolid} from '@heroicons/react/24/solid';

// ─── Star Rating ─────────────────────────────────────────────────────────────
function StarRating({rating, count}: {rating: number; count: number}) {
  const filled = Math.round(rating);
  const empty = 5 - filled;

  return (
    <HStack gap={1} vAlign="center">
      {Array.from({length: filled}, (_, i) => (
        <Icon key={`full-${i}`} icon={StarIconSolid} size="sm" />
      ))}
      {Array.from({length: empty}, (_, i) => (
        <Icon key={`empty-${i}`} icon={StarIcon} size="sm" />
      ))}
      <Text type="body" color="secondary">
        {rating} ({count})
      </Text>
    </HStack>
  );
}

// ─── Image URLs ─────────────────────────────────────────────────────────────
// IMAGES[0] = fallback hero; IMAGES[1..6] = thumbnails (first is selected by default)
const IMAGES = [
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
];

// ─── Product Data ───────────────────────────────────────────────────────────
const PRODUCT = {
  name: 'Solstice Mug & Plate Set',
  price: 89.0,
  originalPrice: 119.0,
  description:
    'A hand-thrown mug and plate set that brings quiet warmth to every meal. The mug sits easy in the hand with a generous 12 oz capacity, while the 8-inch plate works for everything from toast to tapas. Each piece is kiln-fired at 2,300\u00B0F for a finish that resists chips and stains. Subtle variations in the reactive glaze mean no two sets are exactly alike. Dishwasher and microwave safe.',
  composition:
    'High-fire stoneware clay, wheel-thrown and trimmed by hand. Reactive glaze applied by dipping \u2014 color pools and breaks naturally over the clay body. Lead-free and food-safe. Unglazed foot ring reveals the raw clay underneath. Each piece is bisque-fired, glazed, then fired again to cone 10 in a gas reduction kiln.',
  deliveryReturns:
    'Free shipping on all ceramics orders over $75. Each piece is individually wrapped in recycled kraft paper and cushioned for transit. Returns accepted within 30 days \u2014 items must be unused and in original packaging. Replacement pieces available individually.',
  dimensions:
    'Mug height: 9.5 cm / 3.75 in. Mug diameter: 8.5 cm / 3.35 in. Capacity: 350 ml / 12 oz. Plate diameter: 20 cm / 8 in. Plate height: 2 cm / 0.75 in. Weight: 680 g / 1.5 lb (set).',
};

const COLORS = [
  {value: 'snow', label: 'Snow'},
  {value: 'sage', label: 'Sage'},
  {value: 'charcoal', label: 'Charcoal'},
];

const FINISHES = [
  {value: 'matte', label: 'Matte'},
  {value: 'satin', label: 'Satin'},
  {value: 'speckled', label: 'Speckled'},
];

const fmt = (n: number) => `$${n.toFixed(2)}`;

// ─── Image Gallery ──────────────────────────────────────────────────────────
function ImageGallery({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (i: number) => void;
}) {
  const heroSrc = IMAGES[selected + 1] ?? IMAGES[0];
  const thumbnails = IMAGES.slice(1);

  return (
    <VStack gap={3}>
      <AspectRatio ratio={4 / 5}>
        <img style={heroImage} src={heroSrc} alt={PRODUCT.name} />
      </AspectRatio>
      <Grid columns={3} gap={2}>
        {thumbnails.map((src, i) => (
          <AspectRatio key={i} ratio={1}>
            <SelectableCard
              label={`Product image ${i + 1}`}
              isSelected={selected === i}
              onChange={() => onSelect(i)}
              variant="transparent"
              padding={0}
              width="100%"
              height="100%">
              <img
                style={thumbImage}
                src={src}
                alt={`Product image ${i + 1}`}
              />
            </SelectableCard>
          </AspectRatio>
        ))}
      </Grid>
    </VStack>
  );
}

// ─── Product Info ───────────────────────────────────────────────────────────
function ProductInfo() {
  const [color, setColor] = useState('snow');
  const [finish, setFinish] = useState('matte');
  const [quantity, setQuantity] = useState<number | null>(1);

  const decrement = () => setQuantity(q => Math.max(1, (q ?? 1) - 1));
  const increment = () => setQuantity(q => Math.min(10, (q ?? 1) + 1));

  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <Text type="display-2" as="h1">
          {PRODUCT.name}
        </Text>
        <StarRating rating={4.3} count={128} />
        <HStack gap={2} vAlign="center">
          <Text type="large" weight="bold">
            {fmt(PRODUCT.price)}
          </Text>
          <Text type="body" color="secondary" hasStrikethrough>
            {fmt(PRODUCT.originalPrice)}
          </Text>
          <Badge variant="error" label="Sale" />
        </HStack>
      </VStack>
      <Text type="large" weight="normal">
        {PRODUCT.description}
      </Text>
      <VStack gap={2}>
        <Text type="label">Glaze</Text>
        <VStack hAlign="start">
          <SegmentedControl value={color} onChange={setColor} label="Glaze">
            {COLORS.map(c => (
              <SegmentedControlItem
                key={c.value}
                value={c.value}
                label={c.label}
              />
            ))}
          </SegmentedControl>
        </VStack>
      </VStack>
      <VStack gap={2}>
        <Text type="label">Finish</Text>
        <VStack hAlign="start">
          <SegmentedControl value={finish} onChange={setFinish} label="Finish">
            {FINISHES.map(f => (
              <SegmentedControlItem
                key={f.value}
                value={f.value}
                label={f.label}
              />
            ))}
          </SegmentedControl>
        </VStack>
      </VStack>
      <VStack gap={2}>
        <Text type="label">Quantity</Text>
        <HStack gap={1} vAlign="center">
          <Button
            label="Decrease quantity"
            variant="ghost"
            icon={<Icon icon={MinusIcon} size="sm" />}
            clickAction={decrement}
            isDisabled={(quantity ?? 1) <= 1}
            isIconOnly
          />
          <Center width={100}>
            <NumberInput
              label="Quantity"
              isLabelHidden
              value={quantity}
              onChange={setQuantity}
              min={1}
              max={10}
              isIntegerOnly
            />
          </Center>
          <Button
            label="Increase quantity"
            variant="ghost"
            icon={<Icon icon={PlusIcon} size="sm" />}
            clickAction={increment}
            isDisabled={(quantity ?? 1) >= 10}
            isIconOnly
          />
        </HStack>
      </VStack>
      <VStack gap={2}>
        <Button label="Add to Cart" variant="primary" size="lg" />
        <Button label="Buy it now" size="lg" />
      </VStack>
      <CollapsibleGroup type="multiple" defaultValue={['composition']}>
        <Divider />
        <Collapsible
          value="composition"
          trigger={<Heading level={3}>Composition</Heading>}>
          <Text type="body">{PRODUCT.composition}</Text>
        </Collapsible>
        <Divider />
        <Collapsible
          value="delivery"
          defaultIsOpen={false}
          trigger={<Heading level={3}>Delivery &amp; Returns</Heading>}>
          <Text type="body">{PRODUCT.deliveryReturns}</Text>
        </Collapsible>
        <Divider />
        <Collapsible
          value="dimensions"
          defaultIsOpen={false}
          trigger={<Heading level={3}>Dimensions</Heading>}>
          <Text type="body">{PRODUCT.dimensions}</Text>
        </Collapsible>
        <Divider />
      </CollapsibleGroup>
    </VStack>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function ProductDetailTemplate() {
  const [selectedThumb, setSelectedThumb] = useState(0);

  return (
    <Layout
      height="fill"
      contentWidth={1200}
      content={
        <LayoutContent padding={6}>
          <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={5}>
            <ImageGallery
              selected={selectedThumb}
              onSelect={setSelectedThumb}
            />
            <VStack gap={0} style={stickyInfo}>
              <ProductInfo />
            </VStack>
          </Grid>
        </LayoutContent>
      }
    />
  );
}
