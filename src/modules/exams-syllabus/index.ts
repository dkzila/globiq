/**
 * GlobIQ — Exams & Syllabus module (Master Plan §28, §43 P3-S1…S2)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P3-S1: Exam + ExamVersion — the country-scoped exam registry with §36
 *        versioned structures (day-granular, non-overlapping, append-only
 *        windows; the current version is the §11 engine's resolution point).
 * P3-S2: SyllabusNode hierarchy (planned — do not add early, §41).
 */
export {
  ExamError,
  toExamErrorResponse,
  getPublicExams,
  getPublicExam,
  getAdminExams,
  getAdminExam,
  createExam,
  updateExam,
  transitionExam,
  createExamVersion,
  updateExamVersion,
  removeExamVersion,
} from './service'
export {
  createExamSchema,
  updateExamSchema,
  examTransitionSchema,
  createExamVersionSchema,
  updateExamVersionSchema,
  publicExamListQuerySchema,
  adminExamListQuerySchema,
  EXAM_LEVELS,
  EXAM_TRANSITION_ACTIONS,
} from './validation'
export type {
  CreateExamInput,
  UpdateExamInput,
  ExamTransitionInput,
  CreateExamVersionInput,
  UpdateExamVersionInput,
  PublicExamListQuery,
  AdminExamListQuery,
} from './validation'
export type {
  AdminExam,
  AdminExamDetail,
  AdminExamListResult,
  ExamEditability,
  ExamLevelPublic,
  ExamStatusPublic,
  ExamTransitionAction,
  ExamVersionRef,
  PublicExamDetail,
  PublicExamListResult,
  PublicExamSummary,
} from './types'
export {
  EXAM_TRANSITIONS,
  EXAM_EDITABILITY,
  REASON_REQUIRED_TRANSITIONS,
} from './types'
