import { API_ROUTES, apiPath, GlobalSkill, GlobalSkillsResponse } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { tabAuth } from '@/auth/tab-token';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';

async function request(path: string, init?: RequestInit) {
  const response = await tabAuth.fetch(path, init);
  if (!response.ok) throw new Error('Shared skills could not be saved or loaded. Your instructions are still in the form.');
  return response.json();
}

export function GlobalSkillsSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['global-skills'], queryFn: async () => GlobalSkillsResponse.parse(await request(API_ROUTES.globalSkills)).skills });
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [group, setGroup] = useState('');
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  function clear() { setName(''); setContent(''); setGroup(''); setEditing(undefined); setError(undefined); }
  const mutation = useMutation({ mutationFn: async (input: { skill?: GlobalSkill; name: string }) => {
    await request(apiPath(API_ROUTES.globalSkill, { name: input.name }), input.skill === undefined ? { method: 'DELETE' } : { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.skill) });
  }, onSuccess: (_, input) => { if (input.skill !== undefined || editing === input.name) clear(); setSaved(true); void client.invalidateQueries({ queryKey: ['global-skills'] }); } });
  function save(event: React.FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    const parsed = GlobalSkill.safeParse({ name, content, group: group.trim() || null, createdAt: now, updatedAt: now });
    if (!parsed.success) { setError('Use a skill name such as my-helper and enter its instructions.'); return; }
    if (editing === undefined && query.data?.some((skill) => skill.name === parsed.data.name)) { setError('This name already exists. Choose Edit to update that skill.'); return; }
    setError(undefined); setSaved(false); mutation.mutate({ name: parsed.data.name, skill: parsed.data });
  }
  return <section className="flex flex-col gap-4" aria-labelledby="shared-skills-title">
    <Text as="h2" variant="heading" id="shared-skills-title">Shared skills</Text>
    <Text tone="muted">Give your agents reusable instructions for every project. In chat, type /skill-name followed by your request. A matching shared skill takes precedence over an agent command.</Text>
    {query.isPending && <Text role="status">Loading shared skills…</Text>}
    {query.isError && <Notice variant="blocked">Shared skills could not be loaded. <Button onClick={() => void query.refetch()}>Try again</Button></Notice>}
    {query.data?.length === 0 && <Text tone="muted">No shared skills yet. Add instructions below to use them across your projects.</Text>}
    {query.data !== undefined && query.data.length > 0 && <ul aria-label="Saved shared skills" className="flex flex-col gap-2">{query.data.map((skill) => <li key={skill.name} className="flex items-center justify-between gap-4"><div><Text>{skill.name}</Text>{skill.group && <Text variant="caption">{skill.group}</Text>}</div><div className="flex gap-2"><Button disabled={mutation.isPending} aria-label={`Edit ${skill.name}`} onClick={() => { setName(skill.name); setContent(skill.content); setGroup(skill.group ?? ''); setEditing(skill.name); setSaved(false); setError(undefined); }}>Edit</Button><Button disabled={mutation.isPending} aria-label={`Delete ${skill.name}`} onClick={() => { setSaved(false); mutation.mutate({ name: skill.name }); }}>Delete</Button></div></li>)}</ul>}
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field id="shared-skill-name" label="Skill name" description="Use lowercase letters, numbers and hyphens, such as my-helper."><Input id="shared-skill-name" value={name} disabled={mutation.isPending || editing !== undefined} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></Field>
      <Field id="shared-skill-content" label="Instructions" description="Describe what the agent should do when you invoke this skill."><Textarea id="shared-skill-content" value={content} disabled={mutation.isPending} onChange={(event) => { setContent(event.target.value); setSaved(false); }} /></Field>
      <Field id="shared-skill-group" label="Group (optional)"><Input id="shared-skill-group" value={group} disabled={mutation.isPending} onChange={(event) => { setGroup(event.target.value); setSaved(false); }} /></Field>
      {error && <Notice variant="blocked">{error}</Notice>}
      {mutation.isError && <Notice variant="blocked">{mutation.error.message}</Notice>}
      {saved && <Text role="status">Shared skills saved.</Text>}
      <div className="flex gap-2"><Button type="submit" variant="primary" disabled={mutation.isPending || query.isPending || query.isError}>{mutation.isPending ? 'Saving…' : editing === undefined ? 'Add shared skill' : 'Save skill changes'}</Button>{(editing !== undefined || name || content) && <Button type="button" disabled={mutation.isPending} onClick={clear}>Cancel editing</Button>}</div>
    </form>
  </section>;
}
