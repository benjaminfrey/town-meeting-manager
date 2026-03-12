export const queryKeys = {
  // Current authenticated user
  currentUser: ['currentUser'] as const,

  // Towns
  towns: {
    all: ['towns'] as const,
    detail: (townId: string) => ['towns', townId] as const,
  },

  // Boards
  boards: {
    all: ['boards'] as const,
    byTown: (townId: string) => ['boards', 'byTown', townId] as const,
    detail: (boardId: string) => ['boards', boardId] as const,
  },

  // Board members
  members: {
    all: ['members'] as const,
    byBoard: (boardId: string) => ['members', 'byBoard', boardId] as const,
    detail: (memberId: string) => ['members', memberId] as const,
    byPerson: (personId: string) => ['members', 'byPerson', personId] as const,
  },

  // Persons
  persons: {
    all: ['persons'] as const,
    byTown: (townId: string) => ['persons', 'byTown', townId] as const,
    detail: (personId: string) => ['persons', personId] as const,
  },

  // Meetings
  meetings: {
    all: ['meetings'] as const,
    byBoard: (boardId: string) => ['meetings', 'byBoard', boardId] as const,
    byTown: (townId: string) => ['meetings', 'byTown', townId] as const,
    detail: (meetingId: string) => ['meetings', meetingId] as const,
    recent: (townId: string) => ['meetings', 'recent', townId] as const,
  },

  // Agenda items
  agendaItems: {
    byMeeting: (meetingId: string) => ['agendaItems', 'byMeeting', meetingId] as const,
    detail: (itemId: string) => ['agendaItems', itemId] as const,
  },

  // Agenda templates
  agendaTemplates: {
    byBoard: (boardId: string) => ['agendaTemplates', 'byBoard', boardId] as const,
    detail: (templateId: string) => ['agendaTemplates', templateId] as const,
  },

  // Motions
  motions: {
    byMeeting: (meetingId: string) => ['motions', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['motions', 'byItem', agendaItemId] as const,
    detail: (motionId: string) => ['motions', motionId] as const,
  },

  // Vote records
  voteRecords: {
    byMotion: (motionId: string) => ['voteRecords', 'byMotion', motionId] as const,
    byMeeting: (meetingId: string) => ['voteRecords', 'byMeeting', meetingId] as const,
  },

  // Attendance
  attendance: {
    byMeeting: (meetingId: string) => ['attendance', 'byMeeting', meetingId] as const,
    detail: (attendanceId: string) => ['attendance', attendanceId] as const,
  },

  // Minutes
  minutes: {
    byMeeting: (meetingId: string) => ['minutes', 'byMeeting', meetingId] as const,
    detail: (minutesId: string) => ['minutes', minutesId] as const,
  },

  // Exhibits
  exhibits: {
    byMeeting: (meetingId: string) => ['exhibits', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['exhibits', 'byItem', agendaItemId] as const,
  },

  // Executive sessions
  executiveSessions: {
    byMeeting: (meetingId: string) => ['executiveSessions', 'byMeeting', meetingId] as const,
    detail: (sessionId: string) => ['executiveSessions', sessionId] as const,
  },

  // Guest speakers
  guestSpeakers: {
    byMeeting: (meetingId: string) => ['guestSpeakers', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['guestSpeakers', 'byItem', agendaItemId] as const,
  },

  // Agenda item transitions
  agendaItemTransitions: {
    byMeeting: (meetingId: string) => ['agendaItemTransitions', 'byMeeting', meetingId] as const,
  },

  // Future item queues
  futureItemQueues: {
    byMeeting: (meetingId: string) => ['futureItemQueues', 'byMeeting', meetingId] as const,
  },

  // Minutes documents
  minutesDocuments: {
    byMeeting: (meetingId: string) => ['minutesDocuments', 'byMeeting', meetingId] as const,
  },

  // User accounts
  userAccounts: {
    byTown: (townId: string) => ['userAccounts', 'byTown', townId] as const,
    byPerson: (personId: string) => ['userAccounts', 'byPerson', personId] as const,
  },

  // Push subscriptions
  pushSubscriptions: {
    byUser: (userId: string) => ['pushSubscriptions', 'byUser', userId] as const,
  },

  // Invitations
  invitations: {
    byPerson: (personId: string) => ['invitations', 'byPerson', personId] as const,
    byBoard: (boardId: string) => ['invitations', 'byBoard', boardId] as const,
    byTown: (townId: string) => ['invitations', 'byTown', townId] as const,
  },

  // Notification preferences
  notificationPreferences: {
    mine: ['notificationPreferences', 'mine'] as const,
  },
} as const;
