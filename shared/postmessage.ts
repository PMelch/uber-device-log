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
