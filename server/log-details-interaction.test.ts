import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from 'vue';
import { useLogDetails } from '../src/composables/useLogDetails';
import type { Device } from '../shared/types';

const device: Device = { id: 'test', name: 'Phone', platform: 'ios', state: 'connected' };
const entry = { key: 1, timestamp: 'now', message: 'message' };

// Mount the composable with Vue's renderer so the real lifecycle listeners run.
// DOM geometry/focus are simulated, while timer, mouse and scroll state transitions
// exercise the same controller used by App.vue.
function mountController() {
  const previous = Object.fromEntries(['window', 'document', 'Element'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = Object.assign(new EventTarget(), { innerWidth: 1024, innerHeight: 900 });
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown });
  let controller!: ReturnType<typeof useLogDetails>;
  let fallbackCalls = 0;
  class TestElement {
    isConnected = true;
    insideCard = false;
    getBoundingClientRect() { return { left: 950, bottom: 450 }; }
    closest(selector: string) { return this.insideCard && selector.includes('.precision-log-detail') ? this : null; }
    focus() { controller.leave(); doc.activeElement = this; controller.focus({ currentTarget: this } as unknown as FocusEvent, entry, device); }
  }
  for (const [key, value] of Object.entries({ window: win, document: doc, Element: TestElement })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const renderer = createRenderer<object, object>({
    insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {},
  });
  const app = renderer.createApp({ setup() { controller = useLogDetails(() => { fallbackCalls++; }); return () => null; } });
  app.mount({});
  const button = new TestElement();
  const pointer = (type = 'pointerenter', element = button, movementX = 0) => ({
    type, pointerType: 'mouse', buttons: 0, currentTarget: element, movementX, movementY: 0,
  }) as unknown as PointerEvent;
  const click = (element = button) => ({ currentTarget: element }) as unknown as MouseEvent;
  return { controller, current: () => controller.record.value, win, doc, button, TestElement, pointer, click, fallbackCalls: () => fallbackCalls,
    unmount() {
      app.unmount();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('hover preview toggles closed on click and does not reopen while the pointer stays on the button', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = mountController();
  try {
    h.controller.preview(h.pointer(), entry, device);
    t.mock.timers.tick(350);
    assert.equal(h.current()?.entry.key, 1);
    h.controller.toggle(h.click(), entry, device);
    assert.equal(h.current(), undefined);
    h.controller.move(h.pointer('pointermove', h.button, 1), entry, device);
    t.mock.timers.tick(500);
    assert.equal(h.current(), undefined);
    h.controller.leave(h.pointer('pointerleave'));
    h.controller.preview(h.pointer(), entry, device);
    t.mock.timers.tick(350);
    assert.equal(h.current()?.entry.key, 1);
  } finally { h.unmount(); }
});
test('click opens a closed card and the next click closes it, including after pointer focus', () => {
  const h = mountController();
  try {
    h.controller.pointerDown();
    h.button.focus();
    assert.equal(h.current(), undefined);
    h.controller.toggle(h.click(), entry, device);
    assert.equal(h.controller.pinned.value, true);
    h.controller.toggle(h.click(), entry, device);
    assert.equal(h.current(), undefined);
  } finally { h.unmount(); }
});
test('scroll dismisses focused and pinned cards and cancels pending previews; stationary scrolling cannot reopen them', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = mountController();
  try {
    h.button.focus();
    h.controller.pinCurrent();
    h.win.dispatchEvent(new Event('scroll'));
    assert.equal(h.current(), undefined);
    const nextButton = new h.TestElement();
    const nextEntry = { ...entry, key: 2 };
    h.controller.preview(h.pointer('pointerenter', nextButton), nextEntry, device);
    t.mock.timers.tick(500);
    assert.equal(h.current(), undefined);
    h.controller.move(h.pointer('pointermove', nextButton, 1), nextEntry, device);
    t.mock.timers.tick(350);
    assert.equal(h.current()?.entry.key, 2);
    h.controller.close();
    h.controller.preview(h.pointer(), entry, device);
    h.win.dispatchEvent(new Event('scroll'));
    t.mock.timers.tick(500);
    assert.equal(h.current(), undefined);
  } finally { h.unmount(); }
});
test('close restores focus without reopening, and leaving/reentering a preview works repeatedly', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = mountController();
  try {
    h.controller.toggle(h.click(), entry, device);
    h.controller.close(true);
    assert.equal(h.doc.activeElement, h.button);
    assert.equal(h.current(), undefined);
    h.controller.leave(h.pointer('pointerleave'));
    h.controller.preview(h.pointer(), entry, device);
    t.mock.timers.tick(350);
    h.controller.leave(h.pointer('pointerleave'));
    t.mock.timers.tick(220);
    assert.equal(h.current(), undefined);
    h.controller.preview(h.pointer(), entry, device);
    t.mock.timers.tick(350);
    assert.equal(h.current()?.entry.key, 1);
  } finally { h.unmount(); }
});
test('scrolling long content inside the popover does not dismiss it', () => {
  const h = mountController();
  try {
    h.controller.toggle(h.click(), entry, device);
    const panel = new h.TestElement(); panel.insideCard = true;
    const scroll = new Event('scroll');
    Object.defineProperty(scroll, 'target', { value: panel });
    h.win.dispatchEvent(scroll);
    assert.equal(h.current()?.entry.key, 1);
  } finally { h.unmount(); }
});
