// Task 4 (B1), Step 6: derive Zod schemas from the Drizzle schema with
// drizzle-zod@0.8.3, so Zod validation and the DB shape can never drift
// independently again (both come from this one schema.ts).
//
// Expect Zod 4 type-level friction here (documented in task-4-report.md):
// `z.coerce` fields can infer as `unknown`, and `.omit()`/`.pick()` can
// produce `Type 'true' is not assignable to type 'never'`. Runtime is
// unaffected in both cases — this file exists to catalogue exactly which
// tables hit which friction, not to work around it.
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import * as schema from "./schema.js";

export const boardMemberInsertSchema = createInsertSchema(schema.boardMember);
export const boardMemberSelectSchema = createSelectSchema(schema.boardMember);
export const boardMemberUpdateSchema = createUpdateSchema(schema.boardMember);

export const voteRecordInsertSchema = createInsertSchema(schema.voteRecord);
export const voteRecordSelectSchema = createSelectSchema(schema.voteRecord);
export const voteRecordUpdateSchema = createUpdateSchema(schema.voteRecord);

export const meetingAttendanceInsertSchema = createInsertSchema(schema.meetingAttendance);
export const meetingAttendanceSelectSchema = createSelectSchema(schema.meetingAttendance);
export const meetingAttendanceUpdateSchema = createUpdateSchema(schema.meetingAttendance);

export const minutesSectionInsertSchema = createInsertSchema(schema.minutesSection);
export const minutesSectionSelectSchema = createSelectSchema(schema.minutesSection);
export const minutesSectionUpdateSchema = createUpdateSchema(schema.minutesSection);

export const agendaTemplateInsertSchema = createInsertSchema(schema.agendaTemplate);
export const agendaTemplateSelectSchema = createSelectSchema(schema.agendaTemplate);
export const agendaTemplateUpdateSchema = createUpdateSchema(schema.agendaTemplate);

export const notificationEventInsertSchema = createInsertSchema(schema.notificationEvent);
export const notificationEventSelectSchema = createSelectSchema(schema.notificationEvent);
export const notificationEventUpdateSchema = createUpdateSchema(schema.notificationEvent);

export const subscriberNotificationPreferenceInsertSchema = createInsertSchema(
  schema.subscriberNotificationPreference,
);
export const subscriberNotificationPreferenceSelectSchema = createSelectSchema(
  schema.subscriberNotificationPreference,
);
export const subscriberNotificationPreferenceUpdateSchema = createUpdateSchema(
  schema.subscriberNotificationPreference,
);

export const townNotificationConfigInsertSchema = createInsertSchema(schema.townNotificationConfig);
export const townNotificationConfigSelectSchema = createSelectSchema(schema.townNotificationConfig);
export const townNotificationConfigUpdateSchema = createUpdateSchema(schema.townNotificationConfig);

export const permissionTemplateInsertSchema = createInsertSchema(schema.permissionTemplate);
export const permissionTemplateSelectSchema = createSelectSchema(schema.permissionTemplate);
export const permissionTemplateUpdateSchema = createUpdateSchema(schema.permissionTemplate);

export const auditLogInsertSchema = createInsertSchema(schema.auditLog);
export const auditLogSelectSchema = createSelectSchema(schema.auditLog);
export const auditLogUpdateSchema = createUpdateSchema(schema.auditLog);

export const personInsertSchema = createInsertSchema(schema.person);
export const personSelectSchema = createSelectSchema(schema.person);
export const personUpdateSchema = createUpdateSchema(schema.person);

export const exhibitInsertSchema = createInsertSchema(schema.exhibit);
export const exhibitSelectSchema = createSelectSchema(schema.exhibit);
export const exhibitUpdateSchema = createUpdateSchema(schema.exhibit);

export const motionInsertSchema = createInsertSchema(schema.motion);
export const motionSelectSchema = createSelectSchema(schema.motion);
export const motionUpdateSchema = createUpdateSchema(schema.motion);

export const notificationDeliveryInsertSchema = createInsertSchema(schema.notificationDelivery);
export const notificationDeliverySelectSchema = createSelectSchema(schema.notificationDelivery);
export const notificationDeliveryUpdateSchema = createUpdateSchema(schema.notificationDelivery);

export const guestSpeakerInsertSchema = createInsertSchema(schema.guestSpeaker);
export const guestSpeakerSelectSchema = createSelectSchema(schema.guestSpeaker);
export const guestSpeakerUpdateSchema = createUpdateSchema(schema.guestSpeaker);

export const agendaItemTransitionInsertSchema = createInsertSchema(schema.agendaItemTransition);
export const agendaItemTransitionSelectSchema = createSelectSchema(schema.agendaItemTransition);
export const agendaItemTransitionUpdateSchema = createUpdateSchema(schema.agendaItemTransition);

export const minutesDocumentInsertSchema = createInsertSchema(schema.minutesDocument);
export const minutesDocumentSelectSchema = createSelectSchema(schema.minutesDocument);
export const minutesDocumentUpdateSchema = createUpdateSchema(schema.minutesDocument);

export const executiveSessionInsertSchema = createInsertSchema(schema.executiveSession);
export const executiveSessionSelectSchema = createSelectSchema(schema.executiveSession);
export const executiveSessionUpdateSchema = createUpdateSchema(schema.executiveSession);

export const agendaItemInsertSchema = createInsertSchema(schema.agendaItem);
export const agendaItemSelectSchema = createSelectSchema(schema.agendaItem);
export const agendaItemUpdateSchema = createUpdateSchema(schema.agendaItem);

export const futureItemQueueInsertSchema = createInsertSchema(schema.futureItemQueue);
export const futureItemQueueSelectSchema = createSelectSchema(schema.futureItemQueue);
export const futureItemQueueUpdateSchema = createUpdateSchema(schema.futureItemQueue);

export const boardInsertSchema = createInsertSchema(schema.board);
export const boardSelectSchema = createSelectSchema(schema.board);
export const boardUpdateSchema = createUpdateSchema(schema.board);

export const meetingInsertSchema = createInsertSchema(schema.meeting);
export const meetingSelectSchema = createSelectSchema(schema.meeting);
export const meetingUpdateSchema = createUpdateSchema(schema.meeting);

export const townInsertSchema = createInsertSchema(schema.town);
export const townSelectSchema = createSelectSchema(schema.town);
export const townUpdateSchema = createUpdateSchema(schema.town);

export const minutesAddendumInsertSchema = createInsertSchema(schema.minutesAddendum);
export const minutesAddendumSelectSchema = createSelectSchema(schema.minutesAddendum);
export const minutesAddendumUpdateSchema = createUpdateSchema(schema.minutesAddendum);

export const pushSubscriptionInsertSchema = createInsertSchema(schema.pushSubscription);
export const pushSubscriptionSelectSchema = createSelectSchema(schema.pushSubscription);
export const pushSubscriptionUpdateSchema = createUpdateSchema(schema.pushSubscription);

export const invitationInsertSchema = createInsertSchema(schema.invitation);
export const invitationSelectSchema = createSelectSchema(schema.invitation);
export const invitationUpdateSchema = createUpdateSchema(schema.invitation);

export const userAccountInsertSchema = createInsertSchema(schema.userAccount);
export const userAccountSelectSchema = createSelectSchema(schema.userAccount);
export const userAccountUpdateSchema = createUpdateSchema(schema.userAccount);
