import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { Device, LogMessage } from '../../shared/types';

export interface DetailRecord { entry: LogMessage & { key: number }; device: Device }

/** One overlay for the whole list; records are parsed only after opening it. */
export function useLogDetails(fallbackFocus: () => void) {
  const record = shallowRef<DetailRecord>();
  const pinned = ref(false);
  const position = ref({ left: '12px', top: '12px', maxHeight: 'calc(100dvh - 24px)' });
  let trigger: HTMLElement | undefined;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let suppressFocus = false;
  let pendingTrigger: HTMLElement | undefined;
  let dismissedTrigger: HTMLElement | undefined;
  let hoverSuppressedByScroll = false;
  function cancelTimers() { clearTimeout(opening); clearTimeout(closing); pendingTrigger = undefined; }
  function keepOpen() { cancelTimers(); }
  function place() {
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const top = Math.max(12, Math.min(box.bottom + 8, window.innerHeight - 540));
    position.value = {
      left: `${Math.max(12, Math.min(box.left - 432, window.innerWidth - 432))}px`,
      top: `${top}px`,
      maxHeight: `${Math.max(120, window.innerHeight - top - 12)}px`,
    };
  }
  function show(entry: DetailRecord['entry'], device: Device | undefined, element: HTMLElement, pin: boolean) {
    if (!device) return;
    cancelTimers();
    if (pinned.value && !pin && trigger === element) return;
    trigger = element;
    record.value = { entry: { ...entry }, device: { ...device } };
    pinned.value = pin;
    place();
  }
  function preview(event: PointerEvent, entry: DetailRecord['entry'], device: Device | undefined) {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    const element = event.currentTarget as HTMLElement;
    if (hoverSuppressedByScroll || dismissedTrigger === element || pendingTrigger === element) return;
    if (record.value?.entry.key === entry.key && trigger === element) { keepOpen(); return; }
    cancelTimers();
    pendingTrigger = element;
    opening = setTimeout(() => show(entry, device, element, false), 350);
  }
  function move(event: PointerEvent, entry: DetailRecord['entry'], device: Device | undefined) {
    // Scrolling can move another button beneath a stationary pointer. Require an
    // actual mouse movement before allowing a new hover preview after scrolling.
    if (!event.movementX && !event.movementY) return;
    hoverSuppressedByScroll = false;
    preview(event, entry, device);
  }
  function focus(event: FocusEvent, entry: DetailRecord['entry'], device: Device | undefined) {
    if (suppressFocus) { suppressFocus = false; return; }
    show(entry, device, event.currentTarget as HTMLElement, false);
  }
  function toggle(event: MouseEvent, entry: DetailRecord['entry'], device: Device | undefined) {
    suppressFocus = false;
    if (record.value?.entry.key === entry.key) { close(); return; }
    dismissedTrigger = undefined;
    show(entry, device, event.currentTarget as HTMLElement, true);
  }
  function leave(event?: PointerEvent | FocusEvent) {
    if (event?.type === 'pointerleave' && event.currentTarget === dismissedTrigger) dismissedTrigger = undefined;
    cancelTimers();
    if (!pinned.value) closing = setTimeout(() => close(false, false), 220);
  }
  function close(restoreFocus = false, suppressHover = true) {
    dismissedTrigger = suppressHover ? trigger ?? pendingTrigger ?? dismissedTrigger : undefined;
    cancelTimers();
    record.value = undefined;
    pinned.value = false;
    if (restoreFocus) {
      suppressFocus = true;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true }); else fallbackFocus();
      suppressFocus = false;
    }
    trigger = undefined;
  }
  function outside(event: PointerEvent) {
    const target = event.target;
    if (target instanceof Element && !target.closest('.precision-log-detail, .precision-detail-trigger')) close();
  }
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && record.value) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }
  function scrolled(event: Event) {
    if (event.target instanceof Element && event.target.closest('.precision-log-detail')) return;
    hoverSuppressedByScroll = true;
    close(false, false);
  }
  onMounted(() => {
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('wheel', scrolled, { capture: true, passive: true });
    window.addEventListener('touchmove', scrolled, { capture: true, passive: true });
  });
  onUnmounted(() => {
    cancelTimers();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('wheel', scrolled, true);
    window.removeEventListener('touchmove', scrolled, true);
  });
  return { record, pinned, position, preview, move, focus, toggle, pointerDown: () => { suppressFocus = true; }, leave, keepOpen, close, pinCurrent: () => { pinned.value = true; } };
}
