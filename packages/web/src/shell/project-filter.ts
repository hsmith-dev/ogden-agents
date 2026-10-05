/**
 * The sidebar's project filter (backlog story 13): with many projects, a
 * field above the list narrows it by name. Needs you is never filtered.
 */

/** From this many projects up, the sidebar shows the filter field (about one screen of collapsed groups). */
export const PROJECT_FILTER_MIN = 8;

/** Whether the sidebar offers the filter for this many projects. */
export function showsProjectFilter(count: number): boolean {
  return count >= PROJECT_FILTER_MIN;
}

/** The projects whose name contains `text`, ignoring case and surrounding spaces; all of them for empty text. */
export function filterProjects<T extends { name: string }>(projects: readonly T[], text: string): readonly T[] {
  const needle = text.trim().toLocaleLowerCase();
  if (needle === '') return projects;
  return projects.filter((project) => project.name.toLocaleLowerCase().includes(needle));
}
