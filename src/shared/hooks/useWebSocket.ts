import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
// Connect to the same host and port as the web page, but on the /ws path
// The dev server (Vite) will proxy this to the real backend.
const WS_URL = `${protocol}//${window.location.host}/ws`;

export function useWebSocket() {
  const queryClient = useQueryClient();
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (ws.current) return;

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log('[WebSocket] Connected to server');
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'TASK_CREATED': {
            const { projectId } = message.payload;
            console.log(`[WebSocket] Task created for project ${projectId}, invalidating task queries.`);
            queryClient.invalidateQueries({ queryKey: ['tasks', { projectId }] });
            break;
          }
          case 'TASK_COMPLETED': {
            const { projectId } = message.payload;
            console.log(`[WebSocket] Task completed for project ${projectId}. Invalidating task & generation queries.`);
            queryClient.invalidateQueries({ queryKey: ['tasks', { projectId }] });
            queryClient.invalidateQueries({ queryKey: ['tasks'] }); // General task list
            queryClient.invalidateQueries({ queryKey: ['generations', projectId] });
            break;
          }
          case 'TASKS_STATUS_UPDATE': {
            const { projectId } = message.payload;
            // console.log(`[WebSocket] Invalidating task queries for project ${projectId} due to status update.`);
            queryClient.invalidateQueries({ queryKey: ['tasks', { projectId }] });
            break;
          }
          case 'GENERATIONS_UPDATED': {
            const { projectId, shotId } = message.payload;
            console.log(`[WebSocket] Invalidating generation/shot queries for project: ${projectId}, shot: ${shotId}`);
            queryClient.invalidateQueries({ queryKey: ['shots', { projectId }] });
            queryClient.invalidateQueries({ queryKey: ['generations', projectId] });
            if (shotId) {
              queryClient.invalidateQueries({ queryKey: ['shots', { shotId }] });
            }
            break;
          }
          default:
            console.warn('[WebSocket] Received unknown message type:', message.type);
            break;
        }
      } catch (error) {
        console.error('[WebSocket] Error parsing message or handling event:', error);
      }
    };

    ws.current.onclose = () => {
      console.log(`[WebSocket] Disconnected from ${WS_URL}`);
      ws.current = null;
    };

    ws.current.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [queryClient]);
} 