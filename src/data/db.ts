import Dexie, { type Table } from 'dexie';
import type { Exercise, Feedback, Template, Session } from './types';

export class FitDB extends Dexie {
  exercises!: Table<Exercise, string>;
  templates!: Table<Template, string>;
  sessions!: Table<Session, string>;
  feedback!: Table<Feedback, string>;

  constructor() {
    super('fitness-training-buddy');
    this.version(1).stores({
      exercises: 'id, userId, name',
      templates: 'id, userId, name',
      sessions: 'id, userId, templateId, date, status',
    });
    // v2 adds app-feedback notes. Dexie upgrades in place, so existing
    // exercises/templates/sessions are untouched.
    this.version(2).stores({
      exercises: 'id, userId, name',
      templates: 'id, userId, name',
      sessions: 'id, userId, templateId, date, status',
      feedback: 'id, userId, createdAt, resolved',
    });
  }
}

export const db = new FitDB();
