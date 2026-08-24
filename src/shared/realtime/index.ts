export { RealtimeConnection, getRealtimeConnection } from './RealtimeConnection';
export { RealtimeEventProcessor, realtimeEventProcessor } from './RealtimeEventProcessor';
export { dataFreshnessManager } from './DataFreshnessManager';

export type {
  ConnectionState,
  ConnectionStatus,
  ProcessedEvent,
  TasksUpdatedEvent,
  TasksCreatedEvent,
  GenerationsInsertedEvent,
  GenerationsUpdatedEvent,
  VariantsChangedEvent,
  TimelinesUpdatedEvent,
  RawDatabaseEvent,
  DatabaseTable,
  DatabaseEventType,
  RealtimeConfig,
} from './types';

export { DEFAULT_REALTIME_CONFIG, INITIAL_CONNECTION_STATE } from './types';
