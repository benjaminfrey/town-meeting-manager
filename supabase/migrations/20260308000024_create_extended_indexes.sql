-- ============================================================
-- Town Meeting Manager — Extended Indexes
-- ============================================================
-- Indexes for tables created in session 01.06:
-- minutes, templates, exhibits, notifications, audit log.
-- ============================================================

-- ─── Minutes Document ──────────────────────────────────────
CREATE INDEX idx_minutes_doc_meeting_id ON minutes_document(meeting_id);
CREATE INDEX idx_minutes_doc_town_id ON minutes_document(town_id);
CREATE INDEX idx_minutes_doc_status ON minutes_document(town_id, status);

-- ─── Minutes Section ───────────────────────────────────────
CREATE INDEX idx_minutes_section_doc_id ON minutes_section(minutes_document_id);
CREATE INDEX idx_minutes_section_town_id ON minutes_section(town_id);
CREATE INDEX idx_minutes_section_sort ON minutes_section(minutes_document_id, sort_order);

-- ─── Agenda Template ───────────────────────────────────────
CREATE INDEX idx_agenda_template_board_id ON agenda_template(board_id);
CREATE INDEX idx_agenda_template_town_id ON agenda_template(town_id);

-- ─── Exhibit ───────────────────────────────────────────────
CREATE INDEX idx_exhibit_agenda_item_id ON exhibit(agenda_item_id);
CREATE INDEX idx_exhibit_town_id ON exhibit(town_id);
CREATE INDEX idx_exhibit_uploaded_by ON exhibit(uploaded_by);

-- ─── Notification Event ────────────────────────────────────
CREATE INDEX idx_notification_event_town_id ON notification_event(town_id);
CREATE INDEX idx_notification_event_type ON notification_event(town_id, event_type);
CREATE INDEX idx_notification_event_status ON notification_event(status)
  WHERE status IN ('pending', 'processing');

-- ─── Notification Delivery ─────────────────────────────────
CREATE INDEX idx_notification_delivery_event_id ON notification_delivery(event_id);
CREATE INDEX idx_notification_delivery_subscriber ON notification_delivery(subscriber_id);
CREATE INDEX idx_notification_delivery_status ON notification_delivery(status)
  WHERE status IN ('pending', 'processing');
CREATE INDEX idx_notification_delivery_town_id ON notification_delivery(town_id);

-- ─── Subscriber Notification Preference ────────────────────
CREATE INDEX idx_subscriber_pref_person ON subscriber_notification_preference(person_id);
CREATE INDEX idx_subscriber_pref_town ON subscriber_notification_preference(town_id);

-- ─── Audit Log ─────────────────────────────────────────────
CREATE INDEX idx_audit_log_town_id ON audit_log(town_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_account_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(town_id, created_at);

-- ─── Permission Template ───────────────────────────────────
CREATE INDEX idx_permission_template_town ON permission_template(town_id);
