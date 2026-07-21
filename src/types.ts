export type GuideCluster = 'hub' | 'start' | 'world' | 'combat' | 'progression' | 'database' | 'updates' | 'tools' | 'trust';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PlayerQuestion {
  q: string;
  a: string;
}

export interface GuidePage {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  cluster: GuideCluster;
  playerTask: string;
  quickAnswer: string;
  confirmed: string[];
  notConfirmed: string[];
  checklist: string[];
  relatedSlugs: string[];
  sourceIds: string[];
  faq: FaqItem[];
  playerQuestions: PlayerQuestion[];
  faqSchemaApproved: boolean;
  popular?: boolean;
  enabled: boolean;
}
