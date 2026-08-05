/**
 * Resolve the thread composer's contextual category.
 *
 * A scoped tab always wins. On All, the open thread's last category is a
 * deliberate, visible prefill; a thread with no history must stay unselected
 * rather than inheriting stale state from the previous tab/thread.
 */
export function resolveComposerCategory(
  activeCategory: string,
  threadLastCategory?: string | null,
): string {
  return activeCategory === "all" ? (threadLastCategory ?? "") : activeCategory;
}