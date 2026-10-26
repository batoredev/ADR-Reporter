// Filter and sort options shared by the pages and the API.

export const DASHBOARD_SORTS = {
  activity: "Most recent activity",
  submitted: "Newest submission",
  serious: "Potentially serious first",
} as const;

export type DashboardSort = keyof typeof DASHBOARD_SORTS;

export const QUEUE_FILTERS = {
  pending: "Pending review",
  unassigned: "Not taken up",
  mine: "Assigned to me",
  serious: "Potentially serious",
  returned: "Returned",
  approved: "Approved",
  all: "All",
} as const;

export type QueueFilter = keyof typeof QUEUE_FILTERS;
