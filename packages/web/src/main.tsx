import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppearanceProvider } from './appearance/appearance-provider';
import { tabAuth } from './auth/tab-token';
import { EventStreamProvider } from './events/event-stream';
import { router } from './router';
import { TooltipProvider } from './ui/tooltip';
import './ui/theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root element');

/** REST reads (from epic 2 on) go through TanStack Query; the event log only invalidates (AD-7). */
const queryClient = new QueryClient();

// After the boot script's launch-code exchange (a local POST), so the first
// render already knows whether this tab is connected.
void tabAuth.ready.then(() =>
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider>
          <EventStreamProvider>
            <TooltipProvider>
              <RouterProvider router={router} />
            </TooltipProvider>
          </EventStreamProvider>
        </AppearanceProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
