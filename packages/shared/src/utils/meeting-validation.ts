/**
 * Meeting creation validation.
 *
 * Validates prerequisites before allowing a new meeting to be created.
 */

export interface MeetingValidationError {
  message: string;
  link: string;
}

export interface MeetingCreationValidation {
  valid: boolean;
  errors: MeetingValidationError[];
}

/**
 * Validate that a board meets the prerequisites for creating a meeting.
 *
 * Requirements:
 * - Board must have at least 3 active members (quorum requires >50%)
 * - Town retention policy must be acknowledged
 */
export function validateMeetingCreation(
  activeMemberCount: number,
  retentionPolicyAcknowledgedAt: string | null,
  boardId: string,
): MeetingCreationValidation {
  const errors: MeetingValidationError[] = [];

  if (activeMemberCount < 3) {
    errors.push({
      message:
        "This board needs at least 3 members before scheduling a meeting.",
      link: `/boards/${boardId}`,
    });
  }

  if (!retentionPolicyAcknowledgedAt) {
    errors.push({
      message:
        "The retention policy must be acknowledged before creating meetings.",
      link: "/dashboard",
    });
  }

  return { valid: errors.length === 0, errors };
}
