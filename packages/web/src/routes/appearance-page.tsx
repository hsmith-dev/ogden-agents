import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useAppearance } from '@/appearance/appearance-provider';
import { AppShortcutSetting } from '@/appearance/app-shortcut-setting';
import type { Density, ThemePreference } from '@/appearance/appearance';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Field } from '@/ui/field';
import { PageBody, PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';

/** `/settings/appearance`: theme, density, Developer mode and terminal screen-reader mode, applied at once and saved in this browser. */
export function AppearancePage() {
  const { appearance, update } = useAppearance();
  return (
    <>
      <WorkspaceHeader title="Appearance" />
      <PageBody>
        <PageSection aria-label="Appearance settings">
          <Field id="theme" control="group" label="Theme" description="System follows your computer's light or dark setting.">
            <ToggleGroup
              type="single"
              aria-labelledby="theme-label"
              aria-describedby="theme-description"
              data-testid="theme"
              value={appearance.theme}
              onValueChange={(value) => {
                if (value !== '') update({ theme: value as ThemePreference });
              }}
            >
              <ToggleGroupItem value="light">
                <Sun aria-hidden />
                Light
              </ToggleGroupItem>
              <ToggleGroupItem value="dark">
                <Moon aria-hidden />
                Dark
              </ToggleGroupItem>
              <ToggleGroupItem value="system">
                <Desktop aria-hidden />
                System
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field id="density" control="group" label="Density" description="Compact fits more on the screen. Nothing moves; rows and text get smaller.">
            <ToggleGroup
              type="single"
              aria-labelledby="density-label"
              aria-describedby="density-description"
              data-testid="density"
              value={appearance.density}
              onValueChange={(value) => {
                if (value !== '') update({ density: value as Density });
              }}
            >
              <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
              <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field
            id="developer-mode"
            layout="inline"
            label="Developer mode"
            description="Uses Compact density, lists each tool call, shows skill names beside plain labels, and shows keyboard hints."
          >
            <Switch
              id="developer-mode"
              data-testid="developer-mode"
              aria-describedby="developer-mode-description"
              checked={appearance.developerMode}
              onCheckedChange={(checked) => update({ developerMode: checked })}
            />
          </Field>
          <Field
            id="terminal-screen-reader"
            layout="inline"
            label="Terminal screen-reader mode"
            description="Makes the terminal readable by a screen reader, for Developer mode's terminal. It can slow a busy terminal down."
          >
            <Switch
              id="terminal-screen-reader"
              data-testid="terminal-screen-reader"
              aria-describedby="terminal-screen-reader-description"
              checked={appearance.terminalScreenReader}
              onCheckedChange={(checked) => update({ terminalScreenReader: checked })}
            />
          </Field>
          <AppShortcutSetting />
        </PageSection>
      </PageBody>
    </>
  );
}
