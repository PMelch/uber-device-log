import { computed, ref, shallowRef } from 'vue';
import type { FlowDiagnostic, FlowSnapshot } from '../../shared/flow-types';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';

/** Parent-owned drafts survive leaving the editor and snapshot polling. */
export function useFlowEditor(
  snapshot: () => FlowSnapshot | null,
  t: (key: MessageKey, params?: MessageParams) => string,
  onSaved: () => void,
) {
  const filename = ref('');
  const source = ref('');
  const priorityTools = shallowRef<typeof import('../flow-priority')>();
  const priorityDraft = computed(
    () =>
      priorityTools.value?.blueprintPriorityDraft(source.value) ?? {
        editable: false,
        value: undefined,
      },
  );
  const priorityOptions = [1, 2, 3, 4, 5] as const;
  const priorityKeys = {
    1: 'flowsPriority1',
    2: 'flowsPriority2',
    3: 'flowsPriority3',
    4: 'flowsPriority4',
    5: 'flowsPriority5',
  } as const;
  function changePriority(event: Event) {
    const updated = priorityTools.value?.setBlueprintPriority(
      source.value,
      Number((event.target as HTMLSelectElement).value),
    );
    if (updated !== undefined) {
      source.value = updated;
      changed();
    }
  }
  const revision = ref<string>();
  const existing = ref(false);
  const busy = ref(false);
  const valid = ref(false);
  const status = ref<MessageKey>();
  const diagnostics = ref<FlowDiagnostic[]>([]);
  const drafts = new Map<string, { source: string; revision?: string; existing: boolean }>();
  function stash() {
    if (filename.value)
      drafts.set(filename.value, {
        source: source.value,
        revision: revision.value,
        existing: existing.value,
      });
  }
  function loadFile(name: string, current = false) {
    stash();
    const file = snapshot()?.files.find((item) => item.filename === name);
    const draft = current ? undefined : drafts.get(name);
    filename.value = name;
    source.value = draft?.source ?? file?.source ?? '';
    revision.value = draft?.revision ?? file?.revision;
    existing.value = draft?.existing ?? !!file;
    valid.value = false;
    status.value = undefined;
    diagnostics.value = [];
  }
  async function initialize() {
    const firstFile = snapshot()?.files[0];
    if (!filename.value && firstFile) loadFile(firstFile.filename);
    try {
      priorityTools.value ??= await import('../flow-priority');
    } catch {
      status.value = 'flowsNetworkError';
    }
  }
  function newFile() {
    stash();
    filename.value = '';
    source.value =
      'version: 1\nid: new-flow\nname: ' +
      JSON.stringify(t('flowsNewName')) +
      '\nstart: start\ntimeout: 90s\ncorrelation:\n  scope: device-session\n  primary: requestId\nsteps:\n  - id: start\n    name: ' +
      JSON.stringify(t('flowsNewStartName')) +
      '\n    match:\n      contains: flow.started\n    extract:\n      requestId: { json: requestId, required: true }\n    next: [done]\n  - id: done\n    name: ' +
      JSON.stringify(t('flowsNewDoneName')) +
      '\n    match:\n      all:\n        - contains: flow.completed\n        - json:\n            path: requestId\n            equalsFrom: { step: start, field: requestId }\n    outcome: completed\n';
    revision.value = undefined;
    existing.value = false;
    changed();
  }
  function changed() {
    valid.value = false;
    status.value = 'flowsChanged';
    diagnostics.value = [];
  }
  async function request(action: 'validate' | 'save') {
    busy.value = true;
    diagnostics.value = [];
    status.value = undefined;
    try {
      const url =
        action === 'validate'
          ? '/api/flows/validate'
          : existing.value
            ? `/api/flows/blueprints/${encodeURIComponent(filename.value)}`
            : '/api/flows/blueprints';
      const response = await fetch(url, {
        method: action === 'save' && existing.value ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot()?.token ?? '' },
        body: JSON.stringify({
          filename: filename.value,
          source: source.value,
          revision: revision.value,
        }),
      });
      const result = await response.json();
      diagnostics.value = result.diagnostics ?? [];
      if (!response.ok) {
        status.value = response.status === 409 ? 'flowsConflict' : 'flowsNetworkError';
        valid.value = false;
        return;
      }
      valid.value = !diagnostics.value.length;
      if (action === 'validate') status.value = valid.value ? 'flowsValid' : undefined;
      else {
        status.value = 'flowsSaved';
        revision.value =
          result.files?.find(
            (file: { filename: string; revision: string }) => file.filename === filename.value,
          )?.revision ??
          result.file?.revision ??
          result.revision;
        existing.value = true;
        drafts.delete(filename.value);
        onSaved();
        valid.value = false;
      }
    } catch {
      status.value = 'flowsNetworkError';
      valid.value = false;
    } finally {
      busy.value = false;
    }
  }
  return {
    filename,
    source,
    priorityDraft,
    priorityOptions,
    priorityKeys,
    changePriority,
    existing,
    busy,
    valid,
    status,
    diagnostics,
    loadFile,
    initialize,
    newFile,
    changed,
    request,
  };
}
