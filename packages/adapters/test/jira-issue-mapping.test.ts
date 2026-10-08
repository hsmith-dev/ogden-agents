/**
 * AD-28's field mapping (epic 18 story 5): Jira issue type to BMad leaf
 * type (set once at creation), Jira status to BMad status (first-sync
 * only — the conflict rule for an already-existing ticket is entry 6's),
 * and Jira priority to BMad severity (bugs only).
 */
import { describe, expect, it } from 'vitest';
import { isEpicIssueType, mapIssueTypeToLeaf, mapJiraStatusToBmad, mapPriorityToSeverity, plainTextFromDescription, titleSlug } from '../src/tickets-jira/jira-issue-mapping.js';

describe('isEpicIssueType', () => {
  it('recognizes "Epic" case-insensitively', () => {
    expect(isEpicIssueType('Epic')).toBe(true);
    expect(isEpicIssueType('epic')).toBe(true);
    expect(isEpicIssueType(' EPIC ')).toBe(true);
  });

  it('is false for anything else, including missing', () => {
    expect(isEpicIssueType('Story')).toBe(false);
    expect(isEpicIssueType(null)).toBe(false);
    expect(isEpicIssueType(undefined)).toBe(false);
  });
});

describe('mapIssueTypeToLeaf', () => {
  it('maps Bug and Defect to bug', () => {
    expect(mapIssueTypeToLeaf('Bug')).toBe('bug');
    expect(mapIssueTypeToLeaf('defect')).toBe('bug');
  });

  it('defaults everything else, including unrecognized or missing, to story (never dropped)', () => {
    expect(mapIssueTypeToLeaf('Story')).toBe('story');
    expect(mapIssueTypeToLeaf('Task')).toBe('story');
    expect(mapIssueTypeToLeaf('Sub-task')).toBe('story');
    expect(mapIssueTypeToLeaf('Some Custom Type')).toBe('story');
    expect(mapIssueTypeToLeaf(null)).toBe('story');
  });
});

describe('mapJiraStatusToBmad', () => {
  it.each([
    ['Backlog', 'draft'],
    ['To Do', 'draft'],
    ['Open', 'draft'],
    ['In Progress', 'in-progress'],
    ['In Review', 'in-review'],
    ['Blocked', 'blocked'],
    ['Done', 'done'],
    ['Closed', 'done'],
  ])('maps a common Jira status %s to %s, recognized', (jira, bmad) => {
    expect(mapJiraStatusToBmad(jira)).toEqual({ status: bmad, recognized: true });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapJiraStatusToBmad('  in progress  ')).toEqual({ status: 'in-progress', recognized: true });
  });

  it('defaults an unrecognized custom status to draft, but marks it unrecognized rather than guessing confidently', () => {
    expect(mapJiraStatusToBmad('Waiting on Vendor')).toEqual({ status: 'draft', recognized: false });
    expect(mapJiraStatusToBmad(null)).toEqual({ status: 'draft', recognized: false });
  });
});

describe('mapPriorityToSeverity', () => {
  it('maps the standard Jira priority scale', () => {
    expect(mapPriorityToSeverity('Highest')).toBe('P0');
    expect(mapPriorityToSeverity('Blocker')).toBe('P0');
    expect(mapPriorityToSeverity('High')).toBe('P1');
    expect(mapPriorityToSeverity('Medium')).toBe('P2');
    expect(mapPriorityToSeverity('Low')).toBe('P3');
    expect(mapPriorityToSeverity('Lowest')).toBe('P3');
  });

  it('leaves an unrecognized or missing priority unset rather than guessing', () => {
    expect(mapPriorityToSeverity('Unknown Priority')).toBeUndefined();
    expect(mapPriorityToSeverity(null)).toBeUndefined();
  });
});

describe('plainTextFromDescription', () => {
  it('passes a plain string through unchanged', () => {
    expect(plainTextFromDescription('Just plain text.')).toBe('Just plain text.');
  });

  it('returns an empty string for null or undefined', () => {
    expect(plainTextFromDescription(null)).toBe('');
    expect(plainTextFromDescription(undefined)).toBe('');
  });

  it('walks an Atlassian Document Format object into plain paragraphs', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second ' }, { type: 'text', text: 'paragraph.' }] },
      ],
    };
    expect(plainTextFromDescription(adf)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('walks a heading and a list without crashing on nested content', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'A heading' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      ],
    };
    expect(plainTextFromDescription(adf)).toContain('A heading');
    expect(plainTextFromDescription(adf)).toContain('one');
  });
});

describe('titleSlug', () => {
  it('lower-cases, collapses non-alphanumeric runs, and trims hyphens', () => {
    expect(titleSlug('Fix the Thing!! (urgent)')).toBe('fix-the-thing-urgent');
  });

  it('caps at 60 characters without a trailing hyphen', () => {
    const long = 'a'.repeat(100);
    expect(titleSlug(long).length).toBeLessThanOrEqual(60);
  });

  it('never returns an empty slug', () => {
    expect(titleSlug('!!!')).toBe('untitled');
    expect(titleSlug('')).toBe('untitled');
  });
});
