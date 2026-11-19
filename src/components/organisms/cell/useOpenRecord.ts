/**
 * The record open in a record list, kept in the URL (`record`) so a link or a reload opens it again.
 */
import { onScopeDispose, ref, watch } from 'vue';
import { getOccurrence, type Occurrence } from '~/lib/gbif';
import { $openRecord } from '~/stores/explorer';

/**
 * The open record's key, two-way with the URL, and the step that keeps it open as a list loads.
 */
export function useOpenRecord() {
  const expanded = ref<number | null>($openRecord.get());
  /** True until the first page loads: a record named by the URL is fetched if that page doesn't hold it. */
  let isRestoring = expanded.value !== null;

  watch(expanded, (key) => $openRecord.set(key));
  // Back and forward move the URL, and the list follows.
  onScopeDispose($openRecord.listen((key) => (expanded.value = key)));

  /**
   * A list's first page with the open record kept open: put first when the URL named a record the page
   * doesn't hold, and closed when it's a record from before (another cell, filter or order).
   */
  async function withOpenRecord(page: readonly Occurrence[], signal: AbortSignal): Promise<Occurrence[]> {
    const key = expanded.value;
    const wasRestoring = isRestoring;
    isRestoring = false;
    if (key === null || page.some((occurrence) => occurrence.key === key)) return [...page];

    // A record GBIF no longer has, or can't send now, just isn't opened; the list still loads.
    const record = wasRestoring ? await getOccurrence(key).catch(() => null) : null;
    if (signal.aborted) return [...page];
    if (!record) {
      expanded.value = null;
      return [...page];
    }
    return [record, ...page];
  }

  return { expanded, withOpenRecord };
}
