import { modelDescription, type LocalEndpointId, type LocalEndpointModelsResponse } from '@ogden-agents/shared';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { chooseEndpointModel, fetchEndpointModels } from './local-endpoints-api';

/**
 * A server's models (epic 14 story 14.5; E14-R3, E14-R7): what it serves with
 * the size, context length and tool support it reports (nothing is guessed),
 * a plain caution for a small context, a small model or no tool support, and
 * **Use for new chats** to choose the model this server's chats start on. A
 * chosen model the server no longer lists is shown as missing with a plain
 * reason and never replaced by another. Switching a chat's model, or a
 * project's default, is the usual model picker's.
 */
export function EndpointModels({ endpointId, chosen, guard }: { endpointId: LocalEndpointId; chosen: string | null; guard: (work: () => Promise<unknown>) => Promise<void> }) {
  const [answer, setAnswer] = useState<LocalEndpointModelsResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    await guard(async () => setAnswer(await fetchEndpointModels(endpointId)));
    setLoading(false);
  };
  const choose = (model: string | null) =>
    guard(async () => {
      await chooseEndpointModel(endpointId, model);
      setAnswer(await fetchEndpointModels(endpointId));
    });
  return (
    <div className="flex flex-col gap-2" data-testid="endpoint-models">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-disabled={loading} onClick={loading ? undefined : () => void load()} data-testid="endpoint-show-models">
          {loading ? 'Reading...' : answer === undefined ? 'Show models' : 'Read models again'}
        </Button>
        {chosen === null ? null : (
          <Text variant="caption" data-testid="endpoint-chosen-model" className="break-words">
            New chats start on {chosen}.
          </Text>
        )}
      </div>
      {answer === undefined ? null : answer.state !== 'ready' && answer.models.length === 0 ? (
        <Text variant="caption" role="status" data-testid="endpoint-models-state">
          {answer.message}
        </Text>
      ) : null}
      {answer?.missing == null ? null : (
        <Notice variant="blocked" glyphLabel="Model missing" data-testid="endpoint-model-missing" action={<Button variant="secondary" onClick={() => void choose(null)}>Clear my choice, use the first model</Button>}>
          The model {answer.missing} isn't on this server any more. Chats won't start until you choose another here. Ogden Agents never switches to a different model for you.
        </Notice>
      )}
      {answer === undefined || answer.models.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {answer.models.map((model) => {
            const detail = modelDescription(model);
            const isChosen = answer.model === model.id;
            return (
              <li key={model.id} className="flex flex-col gap-1 rounded-md bg-muted p-2" data-testid={`endpoint-model-${model.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Text variant="body" className="min-w-0 break-words">
                    {model.id}
                    {detail === undefined ? '' : ` (${detail})`}
                  </Text>
                  {isChosen ? (
                    <Text variant="caption">Used for new chats</Text>
                  ) : (
                    <Button variant="ghost" aria-label={`Use ${model.id} for new chats`} onClick={() => void choose(model.id)}>
                      Use for new chats
                    </Button>
                  )}
                </div>
                {model.contextTokens === undefined && model.toolCall === undefined && model.sizeBytes === undefined ? (
                  <Text variant="caption">The server doesn't say how big this model is or what it can do.</Text>
                ) : null}
                {model.cautions.map((caution) => (
                  <Text key={caution} variant="caption" data-testid="endpoint-model-caution">
                    {caution}
                  </Text>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
