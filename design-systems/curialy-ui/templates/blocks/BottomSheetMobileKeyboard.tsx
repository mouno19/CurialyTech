// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {BottomSheet} from '@curialy/ui/BottomSheet';
import {Button} from '@curialy/ui/Button';
import {Divider} from '@curialy/ui/Divider';
import {Heading} from '@curialy/ui/Heading';
import {VStack} from '@curialy/ui/Stack';
import {Text} from '@curialy/ui/Text';
import {TextArea} from '@curialy/ui/TextArea';
import {TextInput} from '@curialy/ui/TextInput';

interface ProfileFormValues {
  name: string;
  email: string;
  company: string;
  role: string;
  bio: string;
  notes: string;
}

const initialValues: ProfileFormValues = {
  name: '',
  email: '',
  company: '',
  role: '',
  bio: '',
  notes: '',
};

export default function BottomSheetMobileKeyboard() {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState(initialValues);
  const update =
    (field: keyof ProfileFormValues) =>
    (value: string): void =>
      setValues(current => ({...current, [field]: value}));

  return (
    <>
      <Button label="Edit profile" onClick={() => setIsOpen(true)} />
      <BottomSheet
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label="Edit profile"
        height="tall">
        <form
          onSubmit={event => {
            event.preventDefault();
            setIsOpen(false);
          }}>
          <VStack gap={4}>
            <Heading level={3}>Edit profile</Heading>
            <Divider />
            <Text type="supporting" color="secondary">
              Focus fields throughout the form to see them remain visible above
              the mobile keyboard.
            </Text>
            <TextInput
              label="Name"
              value={values.name}
              onChange={update('name')}
            />
            <TextInput
              label="Email"
              type="email"
              value={values.email}
              onChange={update('email')}
            />
            <TextInput
              label="Company"
              value={values.company}
              onChange={update('company')}
            />
            <TextInput
              label="Role"
              value={values.role}
              onChange={update('role')}
            />
            <TextArea
              label="Bio"
              rows={5}
              value={values.bio}
              onChange={update('bio')}
            />
            <TextArea
              label="Notes"
              rows={5}
              value={values.notes}
              onChange={update('notes')}
            />
            <Button label="Save profile" type="submit" />
          </VStack>
        </form>
      </BottomSheet>
    </>
  );
}
