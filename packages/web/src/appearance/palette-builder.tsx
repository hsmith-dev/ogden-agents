import { useState } from 'react';
import { useAppearance } from './appearance-provider';
import { capturePalette, COLOR_FIELDS, PALETTES, parseCustomPalette, type CustomPalette, type PalettePreference } from './palette';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Notice } from '@/ui/notice';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';

function starter(): CustomPalette {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  const style = root.getAttribute('style');
  root.setAttribute('data-theme', 'light');
  root.removeAttribute('style');
  const light = capturePalette(root);
  root.setAttribute('data-theme', 'dark');
  const dark = capturePalette(root);
  if (theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  if (style === null) root.removeAttribute('style'); else root.setAttribute('style', style);
  return { light, dark };
}

export function PaletteBuilder() {
  const { appearance, update } = useAppearance();
  const [draft, setDraft] = useState<CustomPalette>(() => appearance.customPalette ?? starter());
  const [json, setJson] = useState('');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const apply = (value: unknown) => {
    const palette = parseCustomPalette(value);
    if (palette === undefined) {
      setError('Use six-digit hex colors. Text and accent must each have at least 4.5:1 contrast against the background in both modes.');
      setMessage(undefined);
      return;
    }
    setDraft(palette);
    update({ palette: 'custom', customPalette: palette });
    setError(undefined);
    setMessage('Custom palette applied and saved in this browser.');
  };
  return (
    <>
      <Field id="palette" control="group" label="Palette" description="Color presets keep the same layout, typography and status colors. Your choice is saved in this browser.">
        <ToggleGroup type="single" value={appearance.palette ?? 'default'} aria-labelledby="palette-label" aria-describedby="palette-description" onValueChange={(value) => {
          if (value === '') return;
          if (value === 'custom') apply(draft);
          else { update({ palette: value as PalettePreference }); setMessage(undefined); setError(undefined); }
        }}>
          {PALETTES.map((palette) => <ToggleGroupItem key={palette} value={palette}>{palette === 'default' ? 'Ogden' : palette === 'forest' ? 'Forest' : palette === 'ember' ? 'Ember' : 'Custom'}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <details>
        <summary>Build your own theme</summary>
        <div className="flex flex-col gap-4 py-4">
          {(['light', 'dark'] as const).map((mode) => (
            <fieldset key={mode} className="flex flex-col gap-3">
              <legend>{mode === 'light' ? 'Light mode colors' : 'Dark mode colors'}</legend>
              {COLOR_FIELDS.map((field) => (
                <Field key={field} id={`custom-${mode}-${field}`} label={`${mode === 'light' ? 'Light' : 'Dark'} ${field === 'signal' ? 'accent' : field}`} description="Six-digit hex color">
                  <Input id={`custom-${mode}-${field}`} value={draft[mode][field]} spellCheck={false} aria-describedby={`custom-${mode}-${field}-description`} onChange={(event) => {
                    const value = event.target.value;
                    setDraft((previous) => ({ ...previous, [mode]: { ...previous[mode], [field]: value } }));
                  }} />
                </Field>
              ))}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => apply(draft)}>Apply theme</Button>
            <Button variant="outline" onClick={() => {
              update({ palette: 'default', customPalette: undefined });
              setDraft(starter()); setJson(''); setError(undefined); setMessage('Default palette restored.');
            }}>Reset palette</Button>
            <Button variant="outline" onClick={() => { setJson(JSON.stringify({ version: 1, ...draft }, null, 2)); setMessage('Theme JSON is ready to copy below.'); }}>Export theme</Button>
          </div>
          <Field id="theme-json" label="Theme JSON" description="Copy exported JSON to share a theme, or paste a theme and import it. Only validated colors are accepted.">
            <Textarea id="theme-json" value={json} aria-describedby="theme-json-description" onChange={(event) => setJson(event.target.value)} />
          </Field>
          <Button variant="outline" onClick={() => {
            try {
              const value: unknown = JSON.parse(json);
              if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 1) throw new Error('version');
              apply(value);
            } catch { setError('Paste a valid version 1 theme JSON document.'); setMessage(undefined); }
          }}>Import theme</Button>
          {error === undefined ? null : <Notice variant="blocked" role="alert">{error}</Notice>}
          {message === undefined ? null : <Notice role="status">{message}</Notice>}
        </div>
      </details>
    </>
  );
}
