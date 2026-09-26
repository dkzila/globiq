/**
 * GlobIQ — Editorial module (Master Plan §28, §43 P2-S4)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P2-S4: the editorial workspace — EditorialTask board (§6) with §18 role
 * rules (writers work assigned tasks, editors manage), §20 server-side staff
 * scopes (country + language), and the §19 workflow wiring that keeps task
 * state consistent with content transitions.
 */
export {
  EditorialError,
  toEditorialErrorResponse,
  getEditorialTasks,
  getEditorialTask,
  listAssignableStaff,
  createEditorialTask,
  updateEditorialTask,
  transitionEditorialTask,
  wireContentWorkflow,
} from './service'
export {
  createEditorialTaskSchema,
  updateEditorialTaskSchema,
  editorialTaskTransitionSchema,
  editorialTaskListQuerySchema,
} from './validation'
export type {
  CreateEditorialTaskInput,
  UpdateEditorialTaskInput,
  EditorialTaskTransitionInput,
  EditorialTaskListQuery,
} from './validation'
export type {
  AssignableStaff,
  ContentWorkflowEvent,
  EditorialTask,
  EditorialTaskAction,
  EditorialTaskListResult,
  EditorialTaskPriorityPublic,
  EditorialTaskStatusPublic,
  EditorialTaskTypePublic,
} from './types'
export {
  EDITORIAL_TASK_TYPES,
  EDITORIAL_TASK_TYPE_LABELS,
  EDITORIAL_TASK_STATUSES,
  EDITORIAL_TASK_PRIORITIES,
  EDITORIAL_TASK_ACTIONS,
  EDITORIAL_TASK_TRANSITIONS,
  EDITOR_ONLY_TASK_ACTIONS,
} from './types'
