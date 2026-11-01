/** Puts the cursor back in the composer (the page's one composer form). */
export const focusComposer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();
