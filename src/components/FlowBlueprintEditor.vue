<script setup lang="ts">
import { reactive } from 'vue';
import type { FlowSnapshot } from '../../shared/flow-types';
import type { useFlowEditor } from '../composables/useFlowEditor';
import { diagnosticLocation } from '../flow-diagnostics';
import { translate, translateMessage, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../../shared/notifications';

const props = defineProps<{
  editor: ReturnType<typeof useFlowEditor>;
  snapshot: FlowSnapshot;
  locale: Locale;
}>();
const state = reactive(props.editor);
const t = (key: MessageKey, params?: MessageParams) => translate(props.locale, key, params);
</script>

<template>
  <div class="flow-editor-grid">
    <div class="flow-filelist">
      <button
        v-for="file in snapshot.files"
        :key="file.filename"
        type="button"
        :aria-pressed="state.filename === file.filename"
        :disabled="state.busy"
        @click="state.loadFile(file.filename)"
      >
        {{ file.filename }}
      </button>
      <p v-if="!snapshot.files.length">{{ t('flowsNoBlueprints') }}</p>
      <button
        type="button"
        :disabled="state.busy"
        @click="state.newFile"
      >
        + {{ t('flowsNewBlueprint') }}
      </button>
    </div>
    <form
      class="flow-editbody"
      @submit.prevent="state.request('validate')"
    >
      <label for="flow-filename">{{ t('flowsFilename') }}</label
      ><input
        id="flow-filename"
        v-model="state.filename"
        :disabled="state.busy"
        :readonly="state.existing"
        required
        pattern="[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml"
        placeholder="purchase.yaml"
        @input="state.changed"
      /><label for="flow-priority">{{ t('flowsPriority') }}</label
      ><select
        id="flow-priority"
        :value="state.priorityDraft.value ?? ''"
        :disabled="state.busy || !state.priorityDraft.editable"
        @change="state.changePriority"
      >
        <option
          v-if="!state.priorityDraft.editable"
          value=""
          disabled
        ></option>
        <option
          v-for="level in state.priorityOptions"
          :key="level"
          :value="level"
        >
          {{ t(state.priorityKeys[level]) }}
        </option></select
      ><label for="flow-yaml">{{ t('flowsYamlSource') }}</label
      ><textarea
        id="flow-yaml"
        v-model="state.source"
        :disabled="state.busy"
        required
        spellcheck="false"
        aria-describedby="flow-editor-help"
        @input="state.changed"
      ></textarea>
      <p id="flow-editor-help">{{ t('flowsEditorHelp') }}</p>
      <div class="flow-editor-actions">
        <button
          type="submit"
          :disabled="state.busy || !state.filename || !state.source"
        >
          {{ t('flowsValidate') }}</button
        ><button
          type="button"
          :disabled="state.busy || !state.valid"
          @click="state.request('save')"
        >
          {{ t('flowsSave') }}</button
        ><button
          v-if="state.existing"
          type="button"
          :disabled="state.busy"
          @click="state.loadFile(state.filename, true)"
        >
          {{ t('flowsReloadDraft') }}
        </button>
      </div>
      <p
        v-if="state.status"
        role="status"
        :class="{
          'flow-warning': state.status === 'flowsConflict' || state.status === 'flowsNetworkError',
        }"
      >
        {{ t(state.status) }}
      </p>
      <ul
        v-if="state.diagnostics.length"
        class="flow-validation"
        role="status"
      >
        <li
          v-for="(diagnostic, index) in state.diagnostics"
          :key="index"
        >
          <code v-if="diagnosticLocation(diagnostic)">{{ diagnosticLocation(diagnostic) }}</code>
          {{ translateMessage(locale, diagnostic) }}
        </li>
      </ul>
    </form>
  </div>
</template>
