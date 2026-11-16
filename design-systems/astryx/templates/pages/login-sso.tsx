// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type CSSProperties} from 'react';
import {ShieldCheckIcon} from '@heroicons/react/24/outline';
import {VStack, HStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Section} from '@astryxdesign/core/Section';
import {Link} from '@astryxdesign/core/Link';
import {Divider} from '@astryxdesign/core/Divider';
import {Icon} from '@astryxdesign/core/Icon';
import {Avatar} from '@astryxdesign/core/Avatar';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const BG_URL = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';

const pageStyle: CSSProperties = {
  minHeight: '100%',
  backgroundImage: `url(${BG_URL})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
};

type SSOProvider = {
  name: string;
  abbr: string;
};
const SSO_PROVIDERS: Record<string, SSOProvider> = {
  'google.com': {name: 'Google Workspace', abbr: 'G'},
  'microsoft.com': {name: 'Microsoft Entra ID', abbr: 'M'},
  'okta.com': {name: 'Okta', abbr: 'O'},
  'meta.com': {name: 'Meta SSO', abbr: 'M'},
  'apple.com': {name: 'Apple Business', abbr: 'A'},
};

function getProvider(email: string) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? (SSO_PROVIDERS[domain] ?? null) : null;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = 'email' | 'sso-confirm' | 'password-fallback';

export default function LoginSSO() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginFailed, setLoginFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const provider = getProvider(email);
  const emailValid = isValidEmail(email);

  const handleContinue = () => {
    if (!emailValid) {
      return;
    }
    if (provider) {
      setStep('sso-confirm');
    } else {
      setStep('password-fallback');
    }
  };

  const handleBack = () => {
    setStep('email');
    setLoginFailed(false);
    setIsLoading(false);
  };

  const handleSignIn = () => {
    if (!password) {
      setLoginFailed(true);
      return;
    }
    setIsLoading(true);
    setLoginFailed(false);
    setTimeout(() => {
      setIsLoading(false);
      setLoginFailed(true);
    }, 2000);
  };

  return (
    <Center axis="both" padding={6} style={pageStyle}>
      <Card padding={8} width="100%" maxWidth={400}>
        <VStack gap={4} hAlign="stretch">
          {/* ── Step 1: Email entry ── */}
          {step === 'email' && (
            <>
              <VStack gap={1} hAlign="center">
                <Text type="display-1" as="h2">
                  Welcome back
                </Text>
                <Text type="body" color="secondary" size="sm">
                  Enter your details to sign in to your account
                </Text>
              </VStack>

              <VStack gap={2}>
                <TextInput
                  label="Work email"
                  isLabelHidden
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={setEmail}
                  size="lg"
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      handleContinue();
                    }
                  }}
                />
                <TextInput
                  label="Password"
                  isLabelHidden
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={setPassword}
                  size="lg"
                />
              </VStack>

              <Link href="#" size="sm" color="secondary" type="supporting">
                Having trouble signing in?
              </Link>

              <Button
                label="Sign in"
                variant="primary"
                size="lg"
                onClick={handleContinue}
                isDisabled={!emailValid}
              />

              <Divider label="Or sign in with" />

              <Button
                label="Continue with SSO"
                variant="secondary"
                size="lg"
                onClick={handleContinue}
                isDisabled={!emailValid}
              />

              <VStack hAlign="center">
                <Text type="supporting" color="secondary">
                  Don&apos;t have an account?{' '}
                  <Link href="#" type="supporting">
                    Request access
                  </Link>
                </Text>
              </VStack>
            </>
          )}

          {/* ── Step 2a: SSO provider detected ── */}
          {step === 'sso-confirm' && provider && (
            <>
              <VStack gap={2} hAlign="center">
                <Avatar name={provider.name} size={48} />
                <Text type="display-3" as="h2">
                  Sign in with {provider.name}
                </Text>
                <Text type="body" color="secondary" size="sm">
                  You will be redirected back after signing in.
                </Text>
              </VStack>

              <Card padding={0}>
                <Section variant="muted" padding={4}>
                  <HStack gap={2} vAlign="center">
                    <Icon icon={ShieldCheckIcon} color="secondary" />
                    <VStack gap={0}>
                      <Text type="label">{provider.name}</Text>
                      <Text type="supporting" color="secondary">
                        {email}
                      </Text>
                    </VStack>
                  </HStack>
                </Section>
              </Card>

              <VStack gap={3}>
                <Button
                  label={`Continue with ${provider.name}`}
                  variant="primary"
                  size="lg"
                  isLoading={isLoading}
                  onClick={() => setIsLoading(true)}
                />
                <Button
                  label="Use a different email"
                  variant="ghost"
                  size="lg"
                  onClick={handleBack}
                />
              </VStack>
            </>
          )}

          {/* ── Step 2b: No SSO — password fallback ── */}
          {step === 'password-fallback' && (
            <>
              <VStack gap={1} hAlign="center">
                <Text type="display-1" as="h2">
                  Welcome back
                </Text>
                <Text type="body" color="secondary" size="sm">
                  {email}
                </Text>
              </VStack>

              <VStack gap={4}>
                <VStack gap={1}>
                  <TextInput
                    label="Password"
                    type="password"
                    value={password}
                    size="lg"
                    onChange={(v: string) => {
                      setPassword(v);
                      setLoginFailed(false);
                    }}
                    status={
                      loginFailed
                        ? {
                            type: 'error',
                            message: 'Incorrect password. Try again.',
                          }
                        : undefined
                    }
                  />
                  {loginFailed && (
                    <VStack hAlign="end">
                      <Link
                        href="#"
                        size="sm"
                        color="secondary"
                        type="supporting">
                        Forgot password?
                      </Link>
                    </VStack>
                  )}
                </VStack>

                <Button
                  label="Sign in"
                  variant="primary"
                  size="lg"
                  isLoading={isLoading}
                  onClick={handleSignIn}
                />
                <Button
                  label="Use a different email"
                  variant="ghost"
                  size="lg"
                  onClick={handleBack}
                />
              </VStack>
            </>
          )}
        </VStack>
      </Card>
    </Center>
  );
}
