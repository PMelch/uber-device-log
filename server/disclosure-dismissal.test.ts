import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderer, shallowRef } from 'vue';
import { useDisclosureDismissal } from '../src/composables/useDisclosureDismissal';

test('disclosures survive Safari blur before an inside click, dismiss outside interactions and clean up listeners', () => {
  const previous = Object.fromEntries(['document', 'Node'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class TestNode extends EventTarget {}
  const doc = new TestNode();
  const inside = new TestNode();
  const outside = new TestNode();
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: TestNode, configurable: true });
  let open = true;
  let closes = 0;
  const root = shallowRef({ contains: (target: unknown) => target === inside } as unknown as HTMLElement);
  const renderer = createRenderer<object, object>({
    insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  });
  const app = renderer.createApp({ setup() {
    useDisclosureDismissal(root, () => { open = false; closes++; });
    return () => null;
  } });
  const fire = (type: string, target: TestNode) => {
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: target });
    Object.defineProperty(event, 'relatedTarget', { value: null });
    doc.dispatchEvent(event);
  };
  try {
    app.mount({});
    fire('pointerdown', inside);
    fire('focusout', inside);
    assert.equal(open, true, 'Safari blur must not hide the pending click target');
    fire('click', inside);
    fire('focusin', inside);
    assert.equal(open, true);
    fire('focusin', outside);
    assert.equal(open, false, 'Tab to another control closes the disclosure');
    open = true;
    fire('pointerdown', outside);
    assert.equal(open, false, 'Outside clicks close even when their target is not focusable');
    app.unmount();
    fire('pointerdown', outside);
    fire('focusin', outside);
    assert.equal(closes, 2, 'Unmount removes both listeners');
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
