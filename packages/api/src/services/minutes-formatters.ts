import type {
  MinutesContentJson,
  MinutesFormattedContent,
  MinutesFormattedSection,
  MinutesContentSection,
  MinutesMotion,
  MinutesVote,
  MinutesRecusal,
  MinutesSpeaker,
  MinutesRenderOptions,
} from "@town-meeting/shared";

// ─── Main entry point ───────────────────────────────────────────────

export function formatMinutes(
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
): MinutesFormattedContent {
  const firstUseTracker = new Set<string>();

  let sections: MinutesFormattedSection[];
  switch (options.minutes_style) {
    case "action":
      sections = formatActionMinutes(contentJson, options, firstUseTracker);
      break;
    case "summary":
      sections = formatSummaryMinutes(contentJson, options, firstUseTracker);
      break;
    case "narrative":
      sections = formatNarrativeMinutes(contentJson, options, firstUseTracker);
      break;
    default:
      sections = formatSummaryMinutes(contentJson, options, firstUseTracker);
  }

  const adjournmentText = formatAdjournmentText(
    contentJson,
    options,
    firstUseTracker,
  );

  return {
    meeting_header: contentJson.meeting_header,
    attendance: contentJson.attendance,
    sections,
    adjournment_text: adjournmentText,
    certification: contentJson.certification,
  };
}

// ─── Helper: member reference ───────────────────────────────────────

function memberRef(
  fullName: string | null,
  seatTitle: string | null,
  style: string,
  firstUseTracker?: Set<string>,
): string {
  if (!fullName) return "Unknown";

  const parts = fullName.trim().split(/\s+/);
  const lastName = parts[parts.length - 1] ?? fullName;

  switch (style) {
    case "last_name_only":
      return lastName;

    case "title_and_last_name":
      if (seatTitle) {
        return `${seatTitle} ${lastName}`;
      }
      return lastName;

    case "full_name_first_then_last": {
      if (firstUseTracker && !firstUseTracker.has(fullName)) {
        firstUseTracker.add(fullName);
        return fullName;
      }
      return lastName;
    }

    default:
      return lastName;
  }
}

// ─── Helper: format time ────────────────────────────────────────────

function formatTime(isoString: string | null): string {
  if (!isoString) return "";

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, "0");

    return `${displayHours}:${displayMinutes} ${ampm}`;
  } catch {
    return "";
  }
}

// ─── Helper: format vote result ─────────────────────────────────────

function formatVoteResult(vote: MinutesVote): string {
  const passed = vote.result === "passed" || vote.result === "carried";
  const resultWord = passed ? "Passed" : "Failed";

  // Check for unanimous
  if (passed && vote.nays === 0 && vote.abstentions === 0 && vote.absent === 0) {
    return "Passed unanimously";
  }

  let result = `${resultWord} ${vote.yeas}-${vote.nays}`;

  if (vote.abstentions > 0) {
    result += `, ${vote.abstentions} abstaining`;
  }
  if (vote.absent > 0) {
    result += `, ${vote.absent} absent`;
  }

  return result;
}

// ─── Helper: format motion inline ───────────────────────────────────

function formatMotionInline(
  motion: MinutesMotion,
  style: string,
  firstUseTracker: Set<string>,
): string {
  const mover = motion.moved_by
    ? memberRef(motion.moved_by, null, style, firstUseTracker)
    : "A member";
  const seconder = motion.seconded_by
    ? memberRef(motion.seconded_by, null, style, firstUseTracker)
    : null;

  let text = `${mover} moved ${motion.text}`;

  if (seconder) {
    text += `. ${seconder} seconded`;
  }

  if (motion.vote) {
    text += `. ${formatVoteResult(motion.vote)}`;
  } else if (motion.status === "passed" || motion.status === "carried") {
    text += ". Motion carried";
  } else if (motion.status === "failed") {
    text += ". Motion failed";
  }

  text += ".";
  return text;
}

// ─── Helper: format motion block ────────────────────────────────────

function formatMotionBlock(
  motion: MinutesMotion,
  style: string,
  hasDiscussion: boolean,
): string {
  const mover = motion.moved_by
    ? memberRef(motion.moved_by, null, style)
    : "Unknown";
  const seconder = motion.seconded_by
    ? memberRef(motion.seconded_by, null, style)
    : "none";
  const discussionText = hasDiscussion ? "see above" : "none";

  let voteText = "none";
  let resultText = "pending";

  if (motion.vote) {
    const v = motion.vote;
    const parts: string[] = [];
    parts.push(`Yea: ${v.yeas}`);
    parts.push(`Nay: ${v.nays}`);
    parts.push(`Abstain: ${v.abstentions > 0 ? String(v.abstentions) : "none"}`);
    voteText = parts.join(", ");

    const passed = v.result === "passed" || v.result === "carried";
    resultText = passed ? "The motion carried." : "The motion failed.";
  } else {
    const passed = motion.status === "passed" || motion.status === "carried";
    resultText = passed ? "The motion carried." : "The motion failed.";
  }

  return [
    `<div class="motion-block">`,
    `  <div class="motion-field"><span class="motion-label">Motion:</span> <span class="motion-text">${escapeHtml(motion.text)}</span></div>`,
    `  <div class="motion-field"><span class="motion-label">Moved by:</span> ${escapeHtml(mover)}</div>`,
    `  <div class="motion-field"><span class="motion-label">Second:</span> ${escapeHtml(seconder)}</div>`,
    `  <div class="motion-field"><span class="motion-label">Discussion:</span> ${discussionText}</div>`,
    `  <div class="motion-field"><span class="motion-label">Vote:</span> ${voteText}</div>`,
    `  <div class="motion-field"><span class="motion-label">Result:</span> ${resultText}</div>`,
    `</div>`,
  ].join("\n");
}

// ─── Helper: escape HTML ────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Helper: format recusals ────────────────────────────────────────

function formatRecusals(
  recusals: MinutesRecusal[],
  style: string,
  firstUseTracker: Set<string>,
): string {
  if (recusals.length === 0) return "";

  return recusals
    .map((r) => {
      const name = memberRef(r.member, null, style, firstUseTracker);
      return `<p>${escapeHtml(name)} recused from discussion and voting on this item due to ${escapeHtml(r.reason)}.</p>`;
    })
    .join("\n");
}

// ─── Helper: format speakers ────────────────────────────────────────

function formatSpeakers(
  speakers: MinutesSpeaker[],
  sectionType: string,
): string {
  if (speakers.length === 0) return "";

  const lines = speakers.map((s) => {
    let ident: string;
    if (sectionType === "public_hearing") {
      ident = s.name;
      if (s.address) ident += `, ${s.address}`;
    } else if (sectionType === "public_input") {
      ident = s.name || "a member of the public";
    } else {
      ident = s.name || "Unknown";
    }

    const topic = s.topic ? ` spoke regarding ${escapeHtml(s.topic)}` : " spoke";
    return `<p>${escapeHtml(ident)}${topic}.</p>`;
  });

  return lines.join("\n");
}

// ─── Helper: format motions for a given display format ──────────────

function formatMotions(
  motions: MinutesMotion[],
  options: MinutesRenderOptions,
  firstUseTracker: Set<string>,
  hasDiscussion: boolean,
): string {
  if (motions.length === 0) return "";

  return motions
    .map((motion) => {
      if (options.motion_display_format === "block_format") {
        return formatMotionBlock(
          motion,
          options.member_reference_style,
          hasDiscussion,
        );
      }
      return `<p>${escapeHtml(formatMotionInline(motion, options.member_reference_style, firstUseTracker))}</p>`;
    })
    .join("\n");
}

// ─── Section behavior handling ──────────────────────────────────────

function shouldOmitSection(section: MinutesContentSection): boolean {
  if (section.minutes_behavior === "skip") return true;
  // Non-fixed sections with no items and not marked_none → omit
  if (!section.is_fixed && section.items.length === 0 && !section.marked_none) {
    return true;
  }
  return false;
}

function isSectionEmpty(section: MinutesContentSection): boolean {
  return (
    (section.marked_none || section.items.length === 0) &&
    section.is_fixed
  );
}

// ─── Action Minutes Formatter ───────────────────────────────────────

function formatActionMinutes(
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
  firstUseTracker: Set<string>,
): MinutesFormattedSection[] {
  return contentJson.sections.map((section) => {
    if (shouldOmitSection(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "",
        omit: true,
      };
    }

    if (isSectionEmpty(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "<p>None.</p>",
        omit: false,
      };
    }

    const parts: string[] = [];

    for (const item of section.items) {
      if (item.minutes_behavior === "skip") continue;

      if (item.minutes_behavior === "timestamp_only") {
        const time = formatTime(item.timestamp_start);
        if (time) {
          const officer = contentJson.attendance.presiding_officer;
          const officerRef = memberRef(
            officer,
            null,
            options.member_reference_style,
            firstUseTracker,
          );
          parts.push(`<p>${escapeHtml(item.title)} at ${time} by ${escapeHtml(officerRef)}.</p>`);
        }
        continue;
      }

      // Action minutes: only motions, recusals. No discussion.
      const itemParts: string[] = [];

      // Recusals
      const recusalText = formatRecusals(
        item.recusals,
        options.member_reference_style,
        firstUseTracker,
      );
      if (recusalText) itemParts.push(recusalText);

      if (item.minutes_behavior === "action_only" || item.minutes_behavior === "summarize" || item.minutes_behavior === "full_record") {
        // Motions
        const motionText = formatMotions(
          item.motions,
          options,
          firstUseTracker,
          false,
        );

        if (motionText) {
          itemParts.push(motionText);
        } else if (item.is_fixed || item.section_type === "agenda_item") {
          itemParts.push("<p>No action was taken.</p>");
        }
      }

      if (itemParts.length > 0) {
        if (section.items.length > 1) {
          parts.push(`<h4>${escapeHtml(item.title)}</h4>`);
        }
        parts.push(itemParts.join("\n"));
      }
    }

    return {
      title: section.title,
      sort_order: section.sort_order,
      section_type: section.section_type,
      formatted_text: parts.join("\n"),
      omit: false,
    };
  });
}

// ─── Summary Minutes Formatter ──────────────────────────────────────

function formatSummaryMinutes(
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
  firstUseTracker: Set<string>,
): MinutesFormattedSection[] {
  return contentJson.sections.map((section) => {
    if (shouldOmitSection(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "",
        omit: true,
      };
    }

    if (isSectionEmpty(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "<p>None.</p>",
        omit: false,
      };
    }

    const parts: string[] = [];

    for (const item of section.items) {
      if (item.minutes_behavior === "skip") continue;

      if (item.minutes_behavior === "timestamp_only") {
        const time = formatTime(item.timestamp_start);
        if (time) {
          const officer = contentJson.attendance.presiding_officer;
          const officerRef = memberRef(
            officer,
            null,
            options.member_reference_style,
            firstUseTracker,
          );
          parts.push(`<p>${escapeHtml(item.title)} at ${time} by ${escapeHtml(officerRef)}.</p>`);
        }
        continue;
      }

      const itemParts: string[] = [];

      if (section.items.length > 1) {
        itemParts.push(`<h4>${escapeHtml(item.title)}</h4>`);
      }

      // Recusals
      const recusalText = formatRecusals(
        item.recusals,
        options.member_reference_style,
        firstUseTracker,
      );
      if (recusalText) itemParts.push(recusalText);

      // Discussion summary (placeholder for MVP)
      if (item.minutes_behavior === "summarize" || item.minutes_behavior === "full_record") {
        if (item.discussion_summary) {
          itemParts.push(`<p>${escapeHtml(item.discussion_summary)}</p>`);
        } else {
          itemParts.push(
            "<p><em>[Discussion summary to be added during review]</em></p>",
          );
        }
      }

      // Speakers for public sections
      if (
        section.section_type === "public_hearing" ||
        section.section_type === "public_input"
      ) {
        const speakerText = formatSpeakers(item.speakers, section.section_type);
        if (speakerText) itemParts.push(speakerText);
      }

      // Motions
      if (item.minutes_behavior === "action_only" || item.minutes_behavior === "summarize" || item.minutes_behavior === "full_record") {
        const motionText = formatMotions(
          item.motions,
          options,
          firstUseTracker,
          !!item.discussion_summary,
        );

        if (motionText) {
          itemParts.push(motionText);
        } else if (
          section.section_type === "agenda_item" &&
          (item.minutes_behavior === "action_only")
        ) {
          itemParts.push("<p>No action was taken.</p>");
        }
      }

      parts.push(itemParts.join("\n"));
    }

    return {
      title: section.title,
      sort_order: section.sort_order,
      section_type: section.section_type,
      formatted_text: parts.join("\n"),
      omit: false,
    };
  });
}

// ─── Narrative Minutes Formatter ────────────────────────────────────

function formatNarrativeMinutes(
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
  firstUseTracker: Set<string>,
): MinutesFormattedSection[] {
  return contentJson.sections.map((section) => {
    if (shouldOmitSection(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "",
        omit: true,
      };
    }

    if (isSectionEmpty(section)) {
      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        formatted_text: "<p>None.</p>",
        omit: false,
      };
    }

    const parts: string[] = [];

    for (const item of section.items) {
      if (item.minutes_behavior === "skip") continue;

      if (item.minutes_behavior === "timestamp_only") {
        const time = formatTime(item.timestamp_start);
        if (time) {
          const officer = contentJson.attendance.presiding_officer;
          const officerRef = memberRef(
            officer,
            null,
            options.member_reference_style,
            firstUseTracker,
          );
          parts.push(`<p>${escapeHtml(item.title)} at ${time} by ${escapeHtml(officerRef)}.</p>`);
        }
        continue;
      }

      const itemParts: string[] = [];

      if (section.items.length > 1) {
        itemParts.push(`<h4>${escapeHtml(item.title)}</h4>`);
      }

      // Recusals
      const recusalText = formatRecusals(
        item.recusals,
        options.member_reference_style,
        firstUseTracker,
      );
      if (recusalText) itemParts.push(recusalText);

      // Full narrative discussion (placeholder for MVP)
      if (item.minutes_behavior === "summarize" || item.minutes_behavior === "full_record") {
        if (item.discussion_summary) {
          itemParts.push(`<p>${escapeHtml(item.discussion_summary)}</p>`);
        } else {
          itemParts.push(
            "<p><em>[Detailed discussion to be added during review]</em></p>",
          );
        }
      }

      // Speaker attributions — narrative includes them for all relevant sections
      if (
        section.section_type === "public_hearing" ||
        section.section_type === "public_input"
      ) {
        const speakerText = formatSpeakers(item.speakers, section.section_type);
        if (speakerText) itemParts.push(speakerText);
      }

      // Motions
      if (item.minutes_behavior === "action_only" || item.minutes_behavior === "summarize" || item.minutes_behavior === "full_record") {
        const motionText = formatMotions(
          item.motions,
          options,
          firstUseTracker,
          !!item.discussion_summary,
        );

        if (motionText) {
          itemParts.push(motionText);
        } else if (
          section.section_type === "agenda_item" &&
          item.minutes_behavior === "action_only"
        ) {
          itemParts.push("<p>No action was taken.</p>");
        }
      }

      parts.push(itemParts.join("\n"));
    }

    return {
      title: section.title,
      sort_order: section.sort_order,
      section_type: section.section_type,
      formatted_text: parts.join("\n"),
      omit: false,
    };
  });
}

// ─── Adjournment text ───────────────────────────────────────────────

function formatAdjournmentText(
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
  firstUseTracker: Set<string>,
): string | null {
  const adj = contentJson.adjournment;
  if (!adj) return null;

  const time = formatTime(adj.timestamp);
  const officer = adj.adjourned_by
    ? memberRef(adj.adjourned_by, null, options.member_reference_style, firstUseTracker)
    : memberRef(
        contentJson.attendance.presiding_officer,
        null,
        options.member_reference_style,
        firstUseTracker,
      );

  if (adj.method === "without_objection") {
    const timeClause = time ? ` at ${time}` : "";
    return `There being no objection, ${officer} adjourned the meeting${timeClause}.`;
  }

  // method === "motion"
  const timeClause = time ? ` at ${time}` : "";
  let text = `${officer} declared the meeting adjourned${timeClause}.`;

  if (adj.motion) {
    const motionText =
      options.motion_display_format === "block_format"
        ? formatMotionBlock(adj.motion, options.member_reference_style, false)
        : formatMotionInline(
            adj.motion,
            options.member_reference_style,
            firstUseTracker,
          );

    if (options.motion_display_format === "block_format") {
      text += "\n" + motionText;
    } else {
      text += " " + motionText;
    }
  }

  return text;
}
