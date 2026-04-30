import type { ContentUpdate, EditPatch } from "../scanner/types.js";

export interface AppliedEditPatch {
  content: string;
  appliedUpdates: ContentUpdate[];
  skippedUpdates: Array<ContentUpdate & { reason: "missing" | "ambiguous"; count: number }>;
  outcome: "applied" | "partial" | "already_resolved";
}

export function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = content.indexOf(needle, index);
    if (nextIndex === -1) return count;
    count += 1;
    index = nextIndex + needle.length;
  }
}

export function applyOpsLocally(content: string, editPatch: EditPatch): AppliedEditPatch {
  let nextContent = content;
  const appliedUpdates: ContentUpdate[] = [];
  const skippedUpdates: AppliedEditPatch["skippedUpdates"] = [];

  for (const update of editPatch.content_updates) {
    const count = countOccurrences(nextContent, update.old_str);
    if (count === 0) {
      skippedUpdates.push({ ...update, reason: "missing", count });
      continue;
    }

    if (count > 1 && !update.replace_all_matches) {
      skippedUpdates.push({ ...update, reason: "ambiguous", count });
      continue;
    }

    if (update.replace_all_matches) {
      nextContent = nextContent.split(update.old_str).join(update.new_str);
    } else {
      nextContent = nextContent.replace(update.old_str, update.new_str);
    }
    appliedUpdates.push(update);
  }

  const outcome =
    appliedUpdates.length === 0
      ? "already_resolved"
      : skippedUpdates.length > 0
        ? "partial"
        : "applied";

  return {
    content: nextContent,
    appliedUpdates,
    skippedUpdates,
    outcome,
  };
}
