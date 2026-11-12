export interface MessageRecord {
  id: number;
  time: number;
  receiver: string;
  source: string | null;
  origin: string;
  data: string;
}
export interface MessageCapture {
  active: boolean;
  revision: number;
  contexts: string[];
  unavailable: string[];
  records: MessageRecord[];
  dropped: number;
}

/** Frame identities retained by the main log even after the inspector session ends. */
export interface MessageLogRecord extends MessageRecord {
  sourceContext?: import('./console').ConsoleContext;
  receiverContext?: import('./console').ConsoleContext;
}
