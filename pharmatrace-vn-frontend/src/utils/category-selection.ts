export interface CategoryNode {
  id: number;
  children?: CategoryNode[];
}

export type SelectionState = 'checked' | 'partial' | 'none';

const key = (id: number) => String(id);

function descendants(node: CategoryNode): CategoryNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function findPath(tree: CategoryNode[], id: number, trail: CategoryNode[] = []): CategoryNode[] | null {
  for (const node of tree) {
    if (node.id === id) return [...trail, node];
    const found = findPath(node.children ?? [], id, [...trail, node]);
    if (found) return found;
  }
  return null;
}

/**
 * An old link or bookmark may hold only a parent id, which used to mean "this category and everything under it".
 * Expand it so every descendant is listed; the rest of the logic then only deals with explicit ids.
 */
function normalize(tree: CategoryNode[], selected: Set<string>): Set<string> {
  const result = new Set(selected);
  const visit = (node: CategoryNode) => {
    const below = descendants(node);
    if (result.has(key(node.id)) && below.length > 0 && !below.some((n) => result.has(key(n.id)))) {
      below.forEach((n) => result.add(key(n.id)));
    }
    (node.children ?? []).forEach(visit);
  };
  tree.forEach(visit);
  return result;
}

function stateOf(node: CategoryNode, selected: Set<string>): SelectionState {
  const children = node.children ?? [];
  if (children.length === 0) return selected.has(key(node.id)) ? 'checked' : 'none';
  const states = children.map((child) => stateOf(child, selected));
  if (states.every((state) => state === 'checked')) return 'checked';
  if (states.some((state) => state !== 'none')) return 'partial';
  return selected.has(key(node.id)) ? 'checked' : 'none';
}

/** Checkbox state of a category: checked when it and everything under it is selected, partial when only some is. */
export function selectionState(tree: CategoryNode[], selectedIds: string[], id: number): SelectionState {
  const path = findPath(tree, id);
  if (!path) return selectedIds.includes(key(id)) ? 'checked' : 'none';
  return stateOf(path[path.length - 1], normalize(tree, new Set(selectedIds)));
}

/**
 * Selecting a category selects everything under it; clearing it clears everything under it. A parent is selected
 * exactly when all of its children are, so clearing one child leaves the parent partially selected.
 */
export function toggleCategorySelection(tree: CategoryNode[], selectedIds: string[], id: number): string[] {
  const path = findPath(tree, id);
  if (!path) {
    return selectedIds.includes(key(id)) ? selectedIds.filter((x) => x !== key(id)) : [...selectedIds, key(id)];
  }
  const selected = normalize(tree, new Set(selectedIds));
  const node = path[path.length - 1];
  const subtree = [node, ...descendants(node)];
  const select = stateOf(node, selected) !== 'checked';
  subtree.forEach((n) => (select ? selected.add(key(n.id)) : selected.delete(key(n.id))));

  // Re-derive each ancestor from its children, deepest first.
  for (let i = path.length - 2; i >= 0; i--) {
    const ancestor = path[i];
    const allChecked = (ancestor.children ?? []).every((child) => stateOf(child, selected) === 'checked');
    if (allChecked) selected.add(key(ancestor.id)); else selected.delete(key(ancestor.id));
  }
  return [...selected];
}

/** The ids worth showing as filter tags: a fully selected parent stands for everything under it. */
export function topSelectedIds(tree: CategoryNode[], selectedIds: string[]): string[] {
  const selected = normalize(tree, new Set(selectedIds));
  const hidden = new Set<string>();
  const visit = (node: CategoryNode, ancestorChecked: boolean) => {
    if (ancestorChecked) hidden.add(key(node.id));
    const checked = ancestorChecked || (stateOf(node, selected) === 'checked' && selected.has(key(node.id)));
    (node.children ?? []).forEach((child) => visit(child, checked));
  };
  tree.forEach((node) => visit(node, false));
  return selectedIds.filter((x) => !hidden.has(x));
}
