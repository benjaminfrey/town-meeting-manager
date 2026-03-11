/**
 * pdf-lib service for simple PDF generation.
 *
 * Used for meeting notices — single-page text-only documents
 * that don't need complex layout or Puppeteer.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface MeetingNoticeData {
  townName: string;
  boardName: string;
  meetingType: string;
  meetingDate: string;
  meetingTime: string | null;
  location: string | null;
  virtualLink?: string | null;
}

/**
 * Generate a one-page meeting notice PDF.
 */
export async function generateMeetingNotice(
  data: MeetingNoticeData,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter size in points

  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const { width } = page.getSize();
  const black = rgb(0, 0, 0);
  const gray = rgb(0.3, 0.3, 0.3);

  let y = 700;

  // ─── Town Name (centered, bold, 16pt) ───────────────────────────
  const townText = data.townName.toUpperCase();
  const townWidth = timesBold.widthOfTextAtSize(townText, 16);
  page.drawText(townText, {
    x: (width - townWidth) / 2,
    y,
    size: 16,
    font: timesBold,
    color: black,
  });
  y -= 30;

  // ─── Notice Heading (centered, bold, 14pt) ──────────────────────
  const heading = "NOTICE OF PUBLIC MEETING";
  const headingWidth = timesBold.widthOfTextAtSize(heading, 14);
  page.drawText(heading, {
    x: (width - headingWidth) / 2,
    y,
    size: 14,
    font: timesBold,
    color: black,
  });
  y -= 16;

  // Divider line
  page.drawLine({
    start: { x: 72, y },
    end: { x: width - 72, y },
    thickness: 1,
    color: black,
  });
  y -= 40;

  // ─── Body Text ──────────────────────────────────────────────────
  const meetingTypeLabel =
    data.meetingType === "regular" ? "regular" : data.meetingType;

  // Format the date nicely
  let formattedDate = data.meetingDate;
  try {
    formattedDate = new Date(data.meetingDate + "T00:00:00").toLocaleDateString(
      "en-US",
      { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    );
  } catch {
    // keep raw date
  }

  const bodyLines: string[] = [];
  let mainLine = `The ${data.boardName} of the ${data.townName} will hold a ${meetingTypeLabel} meeting on ${formattedDate}`;
  if (data.meetingTime) {
    mainLine += ` at ${data.meetingTime}`;
  }
  if (data.location) {
    mainLine += ` at ${data.location}`;
  }
  mainLine += ".";
  bodyLines.push(mainLine);

  if (data.virtualLink) {
    bodyLines.push("");
    bodyLines.push(`This meeting will also be available via: ${data.virtualLink}`);
  }

  const maxWidth = width - 144; // 1 inch margins
  const fontSize = 12;

  for (const line of bodyLines) {
    if (!line) {
      y -= fontSize;
      continue;
    }

    // Simple word-wrap
    const words = line.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = timesRoman.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth && currentLine) {
        page.drawText(currentLine, {
          x: 72,
          y,
          size: fontSize,
          font: timesRoman,
          color: black,
        });
        y -= fontSize * 1.5;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      page.drawText(currentLine, {
        x: 72,
        y,
        size: fontSize,
        font: timesRoman,
        color: black,
      });
      y -= fontSize * 1.5;
    }
  }

  // ─── Posted Date (bottom) ───────────────────────────────────────
  const postedDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const postedText = `Posted: ${postedDate}`;
  page.drawText(postedText, {
    x: 72,
    y: 100,
    size: 10,
    font: timesRoman,
    color: gray,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
