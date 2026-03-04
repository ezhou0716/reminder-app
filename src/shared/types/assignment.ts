export interface Assignment {
  id: string;
  name: string;
  courseName: string;
  dueAt: string; // ISO 8601 string
  url: string;
  source: 'canvas' | 'gradescope';
  submitted: boolean;
  completed?: boolean;
  dismissed?: boolean; // user manually unchecked a submitted assignment
  calendarRemoved?: boolean; // removed from calendar view (but still in assignments tab)
}
