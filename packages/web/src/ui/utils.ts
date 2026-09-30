import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** The DESIGN.md type roles, registered so `text-body` and `text-foreground` don't cancel each other. */
const TYPE_ROLES = ['display', 'title', 'heading', 'body', 'label', 'caption', 'mono', 'mono-compact'];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_ROLES }],
      shadow: [{ shadow: ['float'] }],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
