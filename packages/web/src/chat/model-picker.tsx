import type { AgentModel, CoreEvent } from '@ogden-agents/shared';
import { CaretDown, Cpu } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';

/**
 * Models in the UI (story 11: each chat runs on a model the user can
 * switch). A model is the agent's own id and name for it; the UI names none
 * itself. The server decides every change; a chat's view follows only
 * `session.model_changed` (else the session as read).
 */

/** What a chat on its agent's own choice of model is called. */
export const agentDefaultLabel = (agentName: string) => `${agentName}'s default`;

/** A model by the agent's name for it, when its list has it, else by its id. */
export function modelLabel(models: readonly AgentModel[] | null | undefined, model: string): string {
  return models?.find((each) => each.id === model)?.name ?? model;
}

/** The chat's model: the latest `session.model_changed` of its stream, else the session as read; `null` is the agent's own choice. */
export function useSessionModel(events: readonly CoreEvent[], read: string | undefined): { model: string | null; refusal: { model: string; reason: string } | undefined } {
  const latest = useMemo(() => events.findLast((event) => event.type === 'session.model_changed'), [events]);
  if (latest?.type !== 'session.model_changed') return { model: read ?? null, refusal: undefined };
  const { model, previous, cause, reason } = latest.payload;
  // The agent moved the chat off a model it couldn't run (its reason says why): offered a way to pick another.
  const refusal = cause === 'agent' && model === null && previous !== null && reason !== undefined ? { model: previous, reason } : undefined;
  return { model, refusal };
}

export interface ModelMenuProps {
  /** The test id of the trigger; the menu is `<testId>-menu`, each choice `<testId>-option`. */
  testId: string;
  /** The menu's heading. */
  title: string;
  /** The trigger's accessible name, naming what it is for and the choice now. */
  ariaLabel: string;
  /** The trigger's visible words: the choice now. */
  text: string;
  /** Shown before `text` on wider screens ("Model:"). */
  prefix?: string | undefined;
  /** The agent's models, or `null` while it hasn't listed any. */
  models: readonly AgentModel[] | null;
  /** The choice now: a model id, or `null` for the first choice. */
  value: string | null;
  /** The first choice, which leaves the choice to someone else (the agent, the app's default). */
  none: { label: string; description: string };
  /** What the menu says while the agent hasn't listed its models. */
  emptyText: string;
  /** Why nothing can be chosen now (the terminal drives); every choice is disabled with it. */
  disabledReason?: string | undefined;
  busy: boolean;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onChoose(model: string | null): void;
  variant?: 'ghost' | 'outline';
}

/**
 * A model choice as a menu (DESIGN.md Composer chip, Settings rows): the
 * first choice leaves it to the agent (or the app's default), then the
 * agent's own models, the current one checked. Before the agent has listed
 * any, the menu says when they appear. A choice the server can't take now
 * is disabled with its reason, still reachable by keyboard.
 */
export function ModelMenu({ testId, title, ariaLabel, text, prefix, models, value, none, emptyText, disabledReason, busy, open, onOpenChange, onChoose, variant = 'ghost' }: ModelMenuProps) {
  const choose = (next: string | null) => {
    if (busy || disabledReason !== undefined || next === value) return;
    onChoose(next);
  };
  // A chosen model the list doesn't have (yet) is still shown, checked.
  const listed = models ?? [];
  const extra: AgentModel[] = value !== null && !listed.some((each) => each.id === value) ? [{ id: value, name: value }] : [];
  return (
    <DropdownMenu {...(open === undefined ? {} : { open })} {...(onOpenChange === undefined ? {} : { onOpenChange })}>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" data-testid={testId} data-model={value ?? ''} aria-label={ariaLabel} aria-busy={busy || undefined} className="min-w-0">
          <Cpu aria-hidden />
          {prefix === undefined ? null : <span className="text-muted-foreground max-sm:sr-only">{prefix}</span>}
          <span className="truncate">{text}</span>
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid={`${testId}-menu`} className="max-h-96 overflow-y-auto">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuChoiceItem
          data-testid={`${testId}-option`}
          data-model=""
          checked={value === null}
          aria-disabled={disabledReason !== undefined || undefined}
          data-disabled={disabledReason !== undefined ? '' : undefined}
          label={none.label}
          description={disabledReason ?? none.description}
          onSelect={(event) => {
            if (disabledReason !== undefined) event.preventDefault();
            choose(null);
          }}
        />
        {[...listed, ...extra].map((model: AgentModel) => (
          <DropdownMenuChoiceItem
            key={model.id}
            data-testid={`${testId}-option`}
            data-model={model.id}
            checked={model.id === value}
            // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
            aria-disabled={disabledReason !== undefined || undefined}
            data-disabled={disabledReason !== undefined ? '' : undefined}
            label={model.name}
            description={disabledReason ?? model.description ?? model.id}
            onSelect={(event) => {
              if (disabledReason !== undefined) event.preventDefault();
              choose(model.id);
            }}
          />
        ))}
        {models === null || models.length === 0 ? (
          <DropdownMenuItem disabled data-testid={`${testId}-empty`} className="text-caption text-muted-foreground">
            {emptyText}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Why a chat's model can't be changed while the terminal drives it (the server refuses it too). */
export const TERMINAL_MODEL_REASON = 'Switch back to the chat to change its model.';

export interface ModelPickerProps {
  agentName: string;
  /** The chat's model, `null` for the agent's own choice. */
  model: string | null;
  /** The agent's models (`GET` session), `null` before it listed any; `undefined` while loading. */
  models: readonly AgentModel[] | null | undefined;
  /** The model the agent said it runs on, when the chat leaves it the choice. */
  current: string | undefined;
  terminalDrives: boolean;
  changing: boolean;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onChoose(model: string | null): void;
}

/**
 * The chat's model picker, beside the agent's name in the composer footer
 * (story 11; DESIGN.md Composer): the model the chat runs on, and the agent's
 * models to switch to. A switch applies to the next message.
 */
export function ModelPicker({ agentName, model, models, current, terminalDrives, changing, open, onOpenChange, onChoose }: ModelPickerProps) {
  const fallback = agentDefaultLabel(agentName);
  const text = model === null ? (current === undefined ? fallback : `${fallback} (${modelLabel(models, current)})`) : modelLabel(models, model);
  return (
    <ModelMenu
      testId="model-picker"
      title="Model for this chat"
      ariaLabel={`Model: ${text}`}
      prefix="Model:"
      text={text}
      models={models ?? null}
      value={model}
      none={{ label: fallback, description: `${agentName} picks the model itself.` }}
      emptyText={`${agentName}'s models appear here once it has started in a chat.`}
      disabledReason={terminalDrives ? TERMINAL_MODEL_REASON : undefined}
      busy={changing}
      open={open}
      onOpenChange={onOpenChange}
      onChoose={onChoose}
    />
  );
}
