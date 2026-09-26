/**
 * GlobIQ — Phase Roadmap
 * Derived from Master Plan §40 (Phase Plan) and §43 (Detailed Session Roadmap).
 * P0 outputs are frozen inside the Master Plan document itself (v2.0).
 */

export type PhaseStatus = 'done' | 'current' | 'upcoming' | 'future'

export interface Phase {
  id: string
  title: string
  scope: string
  sessions: number
  status: PhaseStatus
}

export const PHASES: Phase[] = [
  { id: 'P0', title: 'Design Freeze', scope: 'Scope, domain model, URLs, RBAC, API conventions', sessions: 5, status: 'done' },
  { id: 'P1', title: 'Foundation', scope: 'Project, auth, country/language, taxonomy, audit', sessions: 5, status: 'done' },
  { id: 'P2', title: 'Knowledge & Editorial', scope: 'KnowledgeUnits, content, sources, editorial workflow', sessions: 5, status: 'done' },
  { id: 'P3', title: 'Exams & Combination Engine', scope: 'Exams, syllabus, mappings, multi-exam union', sessions: 5, status: 'current' },
  { id: 'P4', title: 'Search, SEO & Homepages', scope: 'Search, country homepages, sitemaps', sessions: 5, status: 'upcoming' },
  { id: 'P5', title: 'Personalisation', scope: 'Follows, saves, goals, dashboard', sessions: 5, status: 'upcoming' },
  { id: 'P6', title: 'Current Affairs', scope: 'Event-centric system, feeds, freshness', sessions: 5, status: 'upcoming' },
  { id: 'P7', title: 'Assessment & Mastery', scope: 'QnA, questions, mock tests, revision', sessions: 5, status: 'upcoming' },
  { id: 'P8', title: 'Sharing, Notifications & Quality', scope: 'Sharing, notifications, feedback loop, analytics', sessions: 5, status: 'upcoming' },
  { id: 'P9', title: 'Multilingual & Country Launch', scope: 'Translation framework, second country', sessions: 5, status: 'upcoming' },
  { id: 'P10', title: 'Scale & Advanced AI', scope: 'Performance, search infra, AI assistance', sessions: 5, status: 'upcoming' },
  { id: 'P11', title: 'Mobile Apps', scope: 'Native apps on existing APIs (future)', sessions: 0, status: 'future' },
]
