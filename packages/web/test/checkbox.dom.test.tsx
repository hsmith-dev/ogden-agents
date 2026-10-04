// @vitest-environment happy-dom
/**
 * The checkbox option (story 10.4, reviewed against DESIGN.md in story
 * 10.8): a native button that leaves Space to the browser and blocks
 * Enter; a click on it or its label toggles it; its label is its accessible
 * name and its caption its description; and disabled it neither toggles nor
 * hides that it is disabled.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckboxOption } from '../src/ui/checkbox';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false);
  return <CheckboxOption id="planning" label="Planning" description="Plan the work first." checked={checked} disabled={disabled} onCheckedChange={(next) => setChecked(next === true)} />;
}

const box = () => screen.getByRole('checkbox', { name: 'Planning' });

afterEach(cleanup);

describe('CheckboxOption', () => {
  it('has the label as its accessible name, the caption as its description, and data-slot="checkbox" on the box', () => {
    render(<Harness />);
    expect(box().getAttribute('data-slot')).toBe('checkbox');
    const describedBy = box().getAttribute('aria-describedby');
    expect(describedBy).toBe('planning-description');
    expect(document.getElementById(describedBy!)?.textContent).toBe('Plan the work first.');
  });

  it('is a native button: Space is left to the browser, Enter is blocked, and a click toggles it', async () => {
    render(<Harness />);
    box().focus();
    expect(document.activeElement).toBe(box());
    // A native button: the browser turns Space into a click, which happy-dom doesn't emulate. So check
    // that Space's keydown is left to the browser, Enter's is stopped, and the click toggles.
    expect(box().tagName).toBe('BUTTON');
    expect(box().getAttribute('type')).toBe('button');
    let enterAllowed = true;
    let spaceAllowed = false;
    await act(async () => {
      enterAllowed = fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter' });
      spaceAllowed = fireEvent.keyDown(box(), { key: ' ', code: 'Space' });
    });
    expect(enterAllowed).toBe(false);
    expect(spaceAllowed).toBe(true);
    expect(box().getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      fireEvent.click(box());
    });
    expect(box().getAttribute('aria-checked')).toBe('true');
  });

  it('a click on its label toggles it', async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText('Planning'));
    });
    expect(box().getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByText('Plan the work first.'));
    });
    expect(box().getAttribute('aria-checked')).toBe('false');
  });

  it('disabled, neither the box nor its label toggles it', async () => {
    render(<Harness disabled />);
    expect((box() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText('Planning'));
      fireEvent.click(box());
    });
    expect(box().getAttribute('aria-checked')).toBe('false');
  });
});
