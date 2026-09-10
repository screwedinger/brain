export type MemorySource = 'navigation' | 'page' | 'manual' | 'session';

export type BrowserEventType =
  | 'tab_created'
  | 'tab_updated'
  | 'tab_activated'
  | 'tab_removed'
  | 'navigation';

export interface BrowserEvent {
  id: string;
  type: BrowserEventType;
  timestamp: number;
  tabId?: number;
  windowId?: number;
  url?: string;
  title?: string;
  transitionType?: string;
}

export interface PageRecord {
  id: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  description?: string;
  contentText?: string;
  headings?: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  visitCount: number;
  contentHash?: string;
}

export interface VisitRecord {
  id: string;
  pageId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  source: MemorySource;
}

export interface MemoryRecord {
  id: string;
  title: string;
  summary?: string;
  topics: string[];
  entities: string[];
  importance?: number;
  confidence?: number;
  sourcePageIds: string[];
  createdAt: number;
  updatedAt: number;
}
