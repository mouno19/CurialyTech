package: @astryxdesign/cli

# Component Migration

Move the app frame first, map shadcn and Radix primitives to components, and wire up command palette, settings, and theme controls.

## Move the App Frame First

Start with AppShell so page migration happens inside the final navigation, spacing, surface, and responsive frame. This also exposes theme and color issues early because every route shares the same shell.

Legacy surface    | Component                             | Notes
----------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------
Header            | TopNav                                | Use for product identity, global actions, account entry, and command/search trigger.
Sidebar           | SideNav                               | Use sections and nested nav items for route groups. Keep selection state driven by the router.
Main page wrapper | AppShell + Layout                     | Let the shell own persistent structure; let route components own page content.
Mobile drawer nav | MobileNav or AppShell mobile behavior | Verify focus, close behavior, and route changes on narrow viewports.
Settings menu     | Popover + Layout + Switch             | Use as the home for theme mode and app preferences.

## Map shadcn and Radix Primitives

Do not wrap old shadcn components in design system styles. Replace the primitive with the component that owns the behavior, accessibility, state classes, and token usage.

Existing primitive     | Component                     | Migration note
---------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------
button / shadcn Button | Button or IconButton          | Use Button for labeled commands and IconButton for icon-only toolbar actions.
input                  | TextInput                     | Keep validation state in status props rather than ad hoc border classes.
textarea               | TextArea                      | Use when multiline editing is the primary action.
switch                 | Switch                        | Use for persisted boolean settings, including theme mode when represented as a binary choice.
checkbox               | CheckboxInput or CheckboxList | Use list variants for grouped selection.
radio group            | RadioList                     | Use when one option must be selected from a visible set.
select / combobox      | Selector or Typeahead         | Use Selector for bounded options and Typeahead for searchable async options.
tabs used as page nav  | TabList                       | Use route state or current page state as the source of truth.
command dialog         | CommandPalette                | Keep app-specific search sources outside the shell and feed searchable items.
dropdown action menu   | DropdownMenu or MoreMenu      | Use MoreMenu for compact overflow actions.
alert / callout        | Banner or Toast               | Use Banner for page or section messages and Toast for transient feedback.
dialog                 | Dialog or AlertDialog         | Use AlertDialog for destructive confirmation and Dialog for task flows.
card-like list row     | ListItem                      | Prefer ListItem for selectable rows instead of styling Button as a row.

## Command Palette, Settings, and Theme

Move global search to CommandPalette once the shell exists. Treat the palette as a view over app commands: routes, contextual actions, create actions, filters, recent items, and entity results. Keep data normalization in app code so search sources always return arrays of searchable items.

Put light and dark mode controls in the settings popover or account menu. The switch or selector should update the mode passed to Theme, not toggle isolated body classes.

Settings popover theme control:
```tsx
function ThemeModeSwitch() {
  const {mode, setMode} = useSettings();
  const isDark = mode === 'dark';

  return (
    <Switch
      label="Dark mode"
      description="Use the dark color theme"
      value={isDark}
      onChange={next => setMode(next ? 'dark' : 'light')}
    />
  );
}
```

Up: astryx docs migration
Previous: astryx docs migration/migration-setup
Next: astryx docs migration/migration-verification
