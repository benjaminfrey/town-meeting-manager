export type DiffSegment = {
  type: 'same' | 'added' | 'removed';
  text: string;
};

/**
 * Compute a word-level diff between two text strings using the
 * Longest Common Subsequence (LCS) algorithm.
 *
 * Splits both strings into word arrays, builds an O(n*m) LCS matrix,
 * then back-tracks to produce diff segments. Consecutive segments of
 * the same type are merged for cleaner output.
 */
export function computeWordDiff(
  oldText: string,
  newText: string,
): DiffSegment[] {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  // Fast-path: both empty
  if (oldWords.length === 0 && newWords.length === 0) {
    return [];
  }

  // Fast-path: one side empty
  if (oldWords.length === 0) {
    return [{ type: 'added', text: newWords.join(' ') }];
  }
  if (newWords.length === 0) {
    return [{ type: 'removed', text: oldWords.join(' ') }];
  }

  // Fast-path: identical
  if (oldText === newText) {
    return [{ type: 'same', text: oldText }];
  }

  const lcs = buildLCSMatrix(oldWords, newWords);
  const raw = backtrack(lcs, oldWords, newWords);

  return mergeSegments(raw);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Split text into words by whitespace, filtering out empty tokens. */
function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Build the LCS length matrix.
 * lcs[i][j] = length of LCS of oldWords[0..i-1] and newWords[0..j-1]
 */
function buildLCSMatrix(oldWords: string[], newWords: string[]): number[][] {
  const rows = oldWords.length + 1;
  const cols = newWords.length + 1;

  const matrix: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        matrix[i]![j] = matrix[i - 1]![j - 1]! + 1;
      } else {
        matrix[i]![j] = Math.max(matrix[i - 1]![j]!, matrix[i]![j - 1]!);
      }
    }
  }

  return matrix;
}

/**
 * Back-track through the LCS matrix to produce an un-merged list of
 * single-word diff segments.
 */
function backtrack(
  lcs: number[][],
  oldWords: string[],
  newWords: string[],
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      segments.push({ type: 'same', text: oldWords[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      segments.push({ type: 'added', text: newWords[j - 1]! });
      j--;
    } else {
      segments.push({ type: 'removed', text: oldWords[i - 1]! });
      i--;
    }
  }

  return segments.reverse();
}

/**
 * Merge consecutive segments that share the same type, joining their
 * text with a single space.
 */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const merged: DiffSegment[] = [{ ...segments[0]! }];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = segments[i]!;

    if (curr.type === prev.type) {
      prev.text += ' ' + curr.text;
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}
