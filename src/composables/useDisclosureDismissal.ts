import { onMounted, onUnmounted, type Ref } from 'vue';

/** Safari can blur a control before clicking a button without focusing that button.
 * Dismiss on an actual outside interaction, not on focusout with a null target.
 */
export function useDisclosureDismissal(root: Ref<HTMLElement | undefined>, close: () => void) {
  function outside(event: Event) {
    if (event.target instanceof Node && !root.value?.contains(event.target)) close();
  }
  onMounted(() => {
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
  });
  onUnmounted(() => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('focusin', outside);
  });
}
