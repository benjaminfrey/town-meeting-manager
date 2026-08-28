import { relations } from "drizzle-orm/relations";
import {
  person,
  boardMember,
  board,
  town,
  motion,
  voteRecord,
  meeting,
  meetingAttendance,
  minutesDocument,
  minutesSection,
  agendaItem,
  agendaTemplate,
  notificationEvent,
  subscriberNotificationPreference,
  townNotificationConfig,
  permissionTemplate,
  auditLog,
  userAccount,
  exhibit,
  notificationDelivery,
  guestSpeaker,
  agendaItemTransition,
  executiveSession,
  futureItemQueue,
  minutesAddendum,
  pushSubscription,
  invitation,
} from "./schema.js";

export const boardMemberRelations = relations(boardMember, ({ one, many }) => ({
  person: one(person, {
    fields: [boardMember.personId],
    references: [person.id],
  }),
  board: one(board, {
    fields: [boardMember.boardId],
    references: [board.id],
  }),
  town: one(town, {
    fields: [boardMember.townId],
    references: [town.id],
  }),
  voteRecords: many(voteRecord),
  meetingAttendances: many(meetingAttendance),
  motions_movedBy: many(motion, {
    relationName: "motion_movedBy_boardMember_id",
  }),
  motions_secondedBy: many(motion, {
    relationName: "motion_secondedBy_boardMember_id",
  }),
  meetings: many(meeting),
}));

export const personRelations = relations(person, ({ one, many }) => ({
  boardMembers: many(boardMember),
  meetingAttendances: many(meetingAttendance),
  subscriberNotificationPreferences: many(subscriberNotificationPreference),
  town: one(town, {
    fields: [person.townId],
    references: [town.id],
  }),
  notificationDeliveries: many(notificationDelivery),
  invitations: many(invitation),
  userAccounts: many(userAccount),
}));

export const boardRelations = relations(board, ({ one, many }) => ({
  boardMembers: many(boardMember),
  agendaTemplates: many(agendaTemplate),
  minutesDocuments: many(minutesDocument),
  futureItemQueues: many(futureItemQueue),
  town: one(town, {
    fields: [board.townId],
    references: [town.id],
  }),
  meetings: many(meeting),
}));

export const townRelations = relations(town, ({ many }) => ({
  boardMembers: many(boardMember),
  voteRecords: many(voteRecord),
  meetingAttendances: many(meetingAttendance),
  minutesSections: many(minutesSection),
  agendaTemplates: many(agendaTemplate),
  notificationEvents: many(notificationEvent),
  subscriberNotificationPreferences: many(subscriberNotificationPreference),
  townNotificationConfigs: many(townNotificationConfig),
  permissionTemplates: many(permissionTemplate),
  auditLogs: many(auditLog),
  people: many(person),
  exhibits: many(exhibit),
  motions: many(motion),
  notificationDeliveries: many(notificationDelivery),
  guestSpeakers: many(guestSpeaker),
  agendaItemTransitions: many(agendaItemTransition),
  minutesDocuments: many(minutesDocument),
  executiveSessions: many(executiveSession),
  agendaItems: many(agendaItem),
  futureItemQueues: many(futureItemQueue),
  boards: many(board),
  meetings: many(meeting),
  minutesAddenda: many(minutesAddendum),
  invitations: many(invitation),
  userAccounts: many(userAccount),
}));

export const voteRecordRelations = relations(voteRecord, ({ one }) => ({
  motion: one(motion, {
    fields: [voteRecord.motionId],
    references: [motion.id],
  }),
  meeting: one(meeting, {
    fields: [voteRecord.meetingId],
    references: [meeting.id],
  }),
  town: one(town, {
    fields: [voteRecord.townId],
    references: [town.id],
  }),
  boardMember: one(boardMember, {
    fields: [voteRecord.boardMemberId],
    references: [boardMember.id],
  }),
}));

export const motionRelations = relations(motion, ({ one, many }) => ({
  voteRecords: many(voteRecord),
  agendaItem: one(agendaItem, {
    fields: [motion.agendaItemId],
    references: [agendaItem.id],
  }),
  meeting: one(meeting, {
    fields: [motion.meetingId],
    references: [meeting.id],
  }),
  town: one(town, {
    fields: [motion.townId],
    references: [town.id],
  }),
  boardMember_movedBy: one(boardMember, {
    fields: [motion.movedBy],
    references: [boardMember.id],
    relationName: "motion_movedBy_boardMember_id",
  }),
  boardMember_secondedBy: one(boardMember, {
    fields: [motion.secondedBy],
    references: [boardMember.id],
    relationName: "motion_secondedBy_boardMember_id",
  }),
  motion: one(motion, {
    fields: [motion.parentMotionId],
    references: [motion.id],
    relationName: "motion_parentMotionId_motion_id",
  }),
  motions: many(motion, {
    relationName: "motion_parentMotionId_motion_id",
  }),
  minutesDocuments: many(minutesDocument),
  executiveSessions: many(executiveSession),
  minutesAddenda: many(minutesAddendum),
}));

export const meetingRelations = relations(meeting, ({ one, many }) => ({
  voteRecords: many(voteRecord),
  meetingAttendances: many(meetingAttendance),
  motions: many(motion),
  guestSpeakers: many(guestSpeaker),
  agendaItemTransitions: many(agendaItemTransition),
  minutesDocuments: many(minutesDocument),
  executiveSessions: many(executiveSession),
  agendaItems: many(agendaItem, {
    relationName: "agendaItem_meetingId_meeting_id",
  }),
  futureItemQueues: many(futureItemQueue),
  board: one(board, {
    fields: [meeting.boardId],
    references: [board.id],
  }),
  town: one(town, {
    fields: [meeting.townId],
    references: [town.id],
  }),
  userAccount: one(userAccount, {
    fields: [meeting.createdBy],
    references: [userAccount.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [meeting.currentAgendaItemId],
    references: [agendaItem.id],
    relationName: "meeting_currentAgendaItemId_agendaItem_id",
  }),
  boardMember: one(boardMember, {
    fields: [meeting.presidingOfficerId],
    references: [boardMember.id],
  }),
  minutesAddenda: many(minutesAddendum),
}));

export const meetingAttendanceRelations = relations(meetingAttendance, ({ one }) => ({
  meeting: one(meeting, {
    fields: [meetingAttendance.meetingId],
    references: [meeting.id],
  }),
  town: one(town, {
    fields: [meetingAttendance.townId],
    references: [town.id],
  }),
  boardMember: one(boardMember, {
    fields: [meetingAttendance.boardMemberId],
    references: [boardMember.id],
  }),
  person: one(person, {
    fields: [meetingAttendance.personId],
    references: [person.id],
  }),
}));

export const minutesSectionRelations = relations(minutesSection, ({ one }) => ({
  minutesDocument: one(minutesDocument, {
    fields: [minutesSection.minutesDocumentId],
    references: [minutesDocument.id],
  }),
  town: one(town, {
    fields: [minutesSection.townId],
    references: [town.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [minutesSection.sourceAgendaItemId],
    references: [agendaItem.id],
  }),
}));

export const minutesDocumentRelations = relations(minutesDocument, ({ one, many }) => ({
  minutesSections: many(minutesSection),
  meeting: one(meeting, {
    fields: [minutesDocument.meetingId],
    references: [meeting.id],
  }),
  town: one(town, {
    fields: [minutesDocument.townId],
    references: [town.id],
  }),
  motion: one(motion, {
    fields: [minutesDocument.approvedByMotionId],
    references: [motion.id],
  }),
  board: one(board, {
    fields: [minutesDocument.boardId],
    references: [board.id],
  }),
  userAccount: one(userAccount, {
    fields: [minutesDocument.createdBy],
    references: [userAccount.id],
  }),
  agendaItems: many(agendaItem),
  minutesAddenda: many(minutesAddendum),
}));

export const agendaItemRelations = relations(agendaItem, ({ one, many }) => ({
  minutesSections: many(minutesSection),
  exhibits: many(exhibit),
  motions: many(motion),
  guestSpeakers: many(guestSpeaker),
  agendaItemTransitions: many(agendaItemTransition),
  executiveSessions: many(executiveSession),
  meeting: one(meeting, {
    fields: [agendaItem.meetingId],
    references: [meeting.id],
    relationName: "agendaItem_meetingId_meeting_id",
  }),
  town: one(town, {
    fields: [agendaItem.townId],
    references: [town.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [agendaItem.parentItemId],
    references: [agendaItem.id],
    relationName: "agendaItem_parentItemId_agendaItem_id",
  }),
  agendaItems: many(agendaItem, {
    relationName: "agendaItem_parentItemId_agendaItem_id",
  }),
  minutesDocument: one(minutesDocument, {
    fields: [agendaItem.sourceMinutesDocumentId],
    references: [minutesDocument.id],
  }),
  futureItemQueues_sourceAgendaItemId: many(futureItemQueue, {
    relationName: "futureItemQueue_sourceAgendaItemId_agendaItem_id",
  }),
  futureItemQueues_placedAgendaItemId: many(futureItemQueue, {
    relationName: "futureItemQueue_placedAgendaItemId_agendaItem_id",
  }),
  meetings: many(meeting, {
    relationName: "meeting_currentAgendaItemId_agendaItem_id",
  }),
}));

export const agendaTemplateRelations = relations(agendaTemplate, ({ one }) => ({
  board: one(board, {
    fields: [agendaTemplate.boardId],
    references: [board.id],
  }),
  town: one(town, {
    fields: [agendaTemplate.townId],
    references: [town.id],
  }),
}));

export const notificationEventRelations = relations(notificationEvent, ({ one, many }) => ({
  town: one(town, {
    fields: [notificationEvent.townId],
    references: [town.id],
  }),
  notificationDeliveries: many(notificationDelivery),
}));

export const subscriberNotificationPreferenceRelations = relations(
  subscriberNotificationPreference,
  ({ one }) => ({
    person: one(person, {
      fields: [subscriberNotificationPreference.personId],
      references: [person.id],
    }),
    town: one(town, {
      fields: [subscriberNotificationPreference.townId],
      references: [town.id],
    }),
  }),
);

export const townNotificationConfigRelations = relations(townNotificationConfig, ({ one }) => ({
  town: one(town, {
    fields: [townNotificationConfig.townId],
    references: [town.id],
  }),
}));

export const permissionTemplateRelations = relations(permissionTemplate, ({ one }) => ({
  town: one(town, {
    fields: [permissionTemplate.townId],
    references: [town.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  town: one(town, {
    fields: [auditLog.townId],
    references: [town.id],
  }),
  userAccount: one(userAccount, {
    fields: [auditLog.userAccountId],
    references: [userAccount.id],
  }),
}));

export const userAccountRelations = relations(userAccount, ({ one, many }) => ({
  auditLogs: many(auditLog),
  exhibits: many(exhibit),
  minutesDocuments: many(minutesDocument),
  meetings: many(meeting),
  minutesAddenda: many(minutesAddendum),
  pushSubscriptions: many(pushSubscription),
  invitations_userAccountId: many(invitation, {
    relationName: "invitation_userAccountId_userAccount_id",
  }),
  invitations_invitedBy: many(invitation, {
    relationName: "invitation_invitedBy_userAccount_id",
  }),
  person: one(person, {
    fields: [userAccount.personId],
    references: [person.id],
  }),
  town: one(town, {
    fields: [userAccount.townId],
    references: [town.id],
  }),
}));

export const exhibitRelations = relations(exhibit, ({ one }) => ({
  agendaItem: one(agendaItem, {
    fields: [exhibit.agendaItemId],
    references: [agendaItem.id],
  }),
  town: one(town, {
    fields: [exhibit.townId],
    references: [town.id],
  }),
  userAccount: one(userAccount, {
    fields: [exhibit.uploadedBy],
    references: [userAccount.id],
  }),
}));

export const notificationDeliveryRelations = relations(notificationDelivery, ({ one }) => ({
  notificationEvent: one(notificationEvent, {
    fields: [notificationDelivery.eventId],
    references: [notificationEvent.id],
  }),
  town: one(town, {
    fields: [notificationDelivery.townId],
    references: [town.id],
  }),
  person: one(person, {
    fields: [notificationDelivery.subscriberId],
    references: [person.id],
  }),
}));

export const guestSpeakerRelations = relations(guestSpeaker, ({ one }) => ({
  meeting: one(meeting, {
    fields: [guestSpeaker.meetingId],
    references: [meeting.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [guestSpeaker.agendaItemId],
    references: [agendaItem.id],
  }),
  town: one(town, {
    fields: [guestSpeaker.townId],
    references: [town.id],
  }),
}));

export const agendaItemTransitionRelations = relations(agendaItemTransition, ({ one }) => ({
  meeting: one(meeting, {
    fields: [agendaItemTransition.meetingId],
    references: [meeting.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [agendaItemTransition.agendaItemId],
    references: [agendaItem.id],
  }),
  town: one(town, {
    fields: [agendaItemTransition.townId],
    references: [town.id],
  }),
}));

export const executiveSessionRelations = relations(executiveSession, ({ one }) => ({
  meeting: one(meeting, {
    fields: [executiveSession.meetingId],
    references: [meeting.id],
  }),
  agendaItem: one(agendaItem, {
    fields: [executiveSession.agendaItemId],
    references: [agendaItem.id],
  }),
  town: one(town, {
    fields: [executiveSession.townId],
    references: [town.id],
  }),
  motion: one(motion, {
    fields: [executiveSession.entryMotionId],
    references: [motion.id],
  }),
}));

export const futureItemQueueRelations = relations(futureItemQueue, ({ one }) => ({
  board: one(board, {
    fields: [futureItemQueue.boardId],
    references: [board.id],
  }),
  town: one(town, {
    fields: [futureItemQueue.townId],
    references: [town.id],
  }),
  meeting: one(meeting, {
    fields: [futureItemQueue.sourceMeetingId],
    references: [meeting.id],
  }),
  agendaItem_sourceAgendaItemId: one(agendaItem, {
    fields: [futureItemQueue.sourceAgendaItemId],
    references: [agendaItem.id],
    relationName: "futureItemQueue_sourceAgendaItemId_agendaItem_id",
  }),
  agendaItem_placedAgendaItemId: one(agendaItem, {
    fields: [futureItemQueue.placedAgendaItemId],
    references: [agendaItem.id],
    relationName: "futureItemQueue_placedAgendaItemId_agendaItem_id",
  }),
}));

export const minutesAddendumRelations = relations(minutesAddendum, ({ one }) => ({
  minutesDocument: one(minutesDocument, {
    fields: [minutesAddendum.minutesDocumentId],
    references: [minutesDocument.id],
  }),
  town: one(town, {
    fields: [minutesAddendum.townId],
    references: [town.id],
  }),
  meeting: one(meeting, {
    fields: [minutesAddendum.adoptingMeetingId],
    references: [meeting.id],
  }),
  motion: one(motion, {
    fields: [minutesAddendum.adoptingMotionId],
    references: [motion.id],
  }),
  userAccount: one(userAccount, {
    fields: [minutesAddendum.createdBy],
    references: [userAccount.id],
  }),
}));

export const pushSubscriptionRelations = relations(pushSubscription, ({ one }) => ({
  userAccount: one(userAccount, {
    fields: [pushSubscription.userAccountId],
    references: [userAccount.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  person: one(person, {
    fields: [invitation.personId],
    references: [person.id],
  }),
  userAccount_userAccountId: one(userAccount, {
    fields: [invitation.userAccountId],
    references: [userAccount.id],
    relationName: "invitation_userAccountId_userAccount_id",
  }),
  town: one(town, {
    fields: [invitation.townId],
    references: [town.id],
  }),
  userAccount_invitedBy: one(userAccount, {
    fields: [invitation.invitedBy],
    references: [userAccount.id],
    relationName: "invitation_invitedBy_userAccount_id",
  }),
}));
