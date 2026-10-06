export interface IAttachmentSection {
  slot: string;
  elements: (Group | Cube)[];
}

/**
 * Checks if a group is a structural parent (only contains attachments, no real content).
 * Groups with a clothingSlot are NOT structural parents - they are attachment roots.
 */
function isStructuralParentOnly(node: any): boolean {
  if (!(node instanceof Group)) return false;
  if (!node.children || node.children.length === 0) return false;

  if (node.clothingSlot && node.clothingSlot.trim() !== '') {
    return false;
  }

  const allChildrenAreAttachments = node.children.every((child: any) => {
    if (child instanceof Cube) {
      return child.clothingSlot && child.clothingSlot.trim() !== '';
    }
    if (child instanceof Group) {
      return (child.clothingSlot && child.clothingSlot.trim() !== '') || isStructuralParentOnly(child);
    }
    return false;
  });

  return allChildrenAreAttachments;
}

/**
 * Walks the Outliner tree and groups matching elements based on their clothingSlot property.
 * Only elements with an explicit clothingSlot property set will be included.
 * Filters out structural parent groups that only contain other attachments.
 */
export function findAttachments(): IAttachmentSection[] {
  const results: IAttachmentSection[] = [];
  const slotMap: { [key: string]: IAttachmentSection } = {};

  function getOrCreateBucket(slot: string): IAttachmentSection {
    if (!slotMap[slot]) {
      const newSection: IAttachmentSection = { slot, elements: [] };
      slotMap[slot] = newSection;
      results.push(newSection);
    }
    return slotMap[slot];
  }

  function walk(node: any) {
    if ((node instanceof Group || node instanceof Cube) && node.clothingSlot && node.clothingSlot.trim() !== '') {
      const slot = node.clothingSlot.trim();
      let ancestor = node.parent;
      let inheritsFromAncestor = false;
      while (ancestor && ancestor instanceof Group) {
        const ancestorSlot = ancestor.clothingSlot?.trim();
        if (ancestorSlot === slot) {
          inheritsFromAncestor = true;
          break;
        }
        ancestor = ancestor.parent;
      }

      if (!inheritsFromAncestor && !isStructuralParentOnly(node)) {
        const bucket = getOrCreateBucket(slot);
        bucket.elements.push(node);
      }
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }

  (Outliner.root || []).forEach(walk);
  results.sort((a, b) => a.slot.localeCompare(b.slot));

  return results;
}

export function getAttachments(): (Group | Cube)[] {
  const allAttachments: (Group | Cube)[] = [];
  findAttachments().forEach(section => {
    allAttachments.push(...section.elements);
  });
  return allAttachments;
}

export function isAttachment(node: any): boolean {
  if (!node) return false;
  return !!(node instanceof Group || node instanceof Cube) && !!node.clothingSlot && node.clothingSlot.trim() !== '';
}
