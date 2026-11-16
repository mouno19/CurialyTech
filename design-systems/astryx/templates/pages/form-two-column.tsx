// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type CSSProperties} from 'react';
import {VStack, HStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Section} from '@astryxdesign/core/Section';
import {Grid} from '@astryxdesign/core/Grid';
import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Token} from '@astryxdesign/core/Token';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Link} from '@astryxdesign/core/Link';
import {Divider} from '@astryxdesign/core/Divider';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';

const ILLUSTRATION_URL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';

const INQUIRY_REASONS = [
  'New business',
  'General inquiry',
  'Press & media',
  'Partnerships',
  'Product feedback',
  'Technical support',
  'Other',
];

const BUDGET_OPTIONS = [
  'Under $10k',
  '$10k – $50k',
  '$50k – $100k',
  '$100k – $500k',
  '$500k+',
  'Not sure yet',
];

const CONTACT_COLUMNS = [
  {label: 'General inquiries', email: 'hello@company.com'},
  {label: 'New business', email: 'newbiz@company.com'},
  {label: 'Press & partnerships', email: 'press@company.com'},
];

// AspectRatio has no objectFit/radius prop and there's no Image primitive
// (#2582), so the cover photo is styled directly. overflow:hidden masks the
// cover crop to the rounded corners.
const pageStyle: CSSProperties = {
  minHeight: '100%',
};
const illustrationImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: 'var(--radius-container)',
  overflow: 'hidden',
};

/**
 * Form (Two-column) — marketing contact form template.
 *
 * Layout:
 *   Top: two-column — left has headline + description + illustration,
 *        right has the contact form on a card.
 *   Bottom: three-column contact info strip.
 *   Mobile (<768px): single column stack.
 */
export default function FormTwoColumnPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [inquiryReason, setInquiryReason] = useState('');
  const [budget, setBudget] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const errors = submitted
    ? {
        fullName: !fullName.trim() ? 'Required' : undefined,
        email: !email.trim() ? 'Required' : undefined,
        details: !details.trim() ? 'Required' : undefined,
      }
    : {};

  const handleSubmit = () => setSubmitted(true);

  return (
    <Center style={pageStyle}>
      <Section maxWidth={1100} width="100%" padding={10} variant="transparent">
        <VStack gap={10}>
          {/* Two-column; stacks to one column below ~520px. */}
          <Grid columns={{minWidth: 320}} align="center" gap={10}>
            <VStack gap={6}>
              <VStack gap={3}>
                <Text type="display-1" as="h1">
                  Let&apos;s work together
                </Text>
                <Text type="body" color="secondary">
                  Tell us what you&apos;re working on and we&apos;ll help you
                  figure out the best path forward.
                </Text>
              </VStack>
              <AspectRatio ratio={4 / 3}>
                <img
                  src={ILLUSTRATION_URL}
                  alt="Two people working at a desk"
                  style={illustrationImg}
                />
              </AspectRatio>
            </VStack>

            <Card padding={8}>
              <VStack gap={4}>
                <Text type="label">Your details</Text>
                <TextInput
                  label="Full name"
                  isLabelHidden
                  placeholder="Full name*"
                  value={fullName}
                  onChange={setFullName}
                  status={
                    errors.fullName
                      ? {type: 'error', message: errors.fullName}
                      : undefined
                  }
                />
                <Grid columns={{minWidth: 180}} gap={3}>
                  <TextInput
                    label="Email"
                    isLabelHidden
                    placeholder="Email*"
                    value={email}
                    onChange={setEmail}
                    status={
                      errors.email
                        ? {type: 'error', message: errors.email}
                        : undefined
                    }
                  />
                  <TextInput
                    label="Company name"
                    isLabelHidden
                    placeholder="Company name"
                    value={company}
                    onChange={setCompany}
                  />
                </Grid>
                <Grid columns={{minWidth: 180}} gap={3}>
                  <TextInput
                    label="Job title"
                    isLabelHidden
                    placeholder="Job title"
                    value={jobTitle}
                    onChange={setJobTitle}
                  />
                  <TextInput
                    label="Phone number"
                    isLabelHidden
                    placeholder="Phone number"
                    value={phone}
                    onChange={setPhone}
                  />
                </Grid>

                <VStack gap={2}>
                  <Text type="label">What are you reaching out about?</Text>
                  <HStack gap={2} wrap="wrap">
                    {INQUIRY_REASONS.map(reason => (
                      <Token
                        key={reason}
                        label={reason}
                        color={inquiryReason === reason ? 'blue' : 'default'}
                        onClick={() =>
                          setInquiryReason(prev =>
                            prev === reason ? '' : reason,
                          )
                        }
                      />
                    ))}
                  </HStack>
                </VStack>
                <Selector
                  label="Budget range"
                  options={BUDGET_OPTIONS}
                  value={budget}
                  onChange={setBudget}
                  placeholder="Select a budget range..."
                />
                <TextArea
                  label="Project details"
                  isLabelHidden
                  placeholder="Project details*"
                  value={details}
                  onChange={setDetails}
                  status={
                    errors.details
                      ? {type: 'error', message: errors.details}
                      : undefined
                  }
                />
                {/* hAlign="stretch" = full-width button workaround; Button
                    has no full-width prop (#2600). */}
                <VStack hAlign="stretch">
                  <Button
                    label="Let's connect"
                    variant="primary"
                    onClick={handleSubmit}
                  />
                </VStack>
              </VStack>
            </Card>
          </Grid>

          {/* Contact strip; stacks below ~440px. */}
          <VStack gap={6}>
            <Divider />
            <Grid columns={{minWidth: 200}} gap={6}>
              {CONTACT_COLUMNS.map(col => (
                <VStack key={col.label} gap={1} hAlign="center">
                  <Text type="supporting" color="secondary">
                    {col.label}
                  </Text>
                  <Link href={`mailto:${col.email}`} type="body" size="sm">
                    {col.email}
                  </Link>
                </VStack>
              ))}
            </Grid>
          </VStack>
        </VStack>
      </Section>
    </Center>
  );
}
