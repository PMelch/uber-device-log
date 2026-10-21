import { isMap, type Document } from 'yaml';

/** Minimal bundled plugin: read one project setting without logging its contents. */
export function createStubPlugin(document: Document) {
  const config = document.getIn(['plugins', 'stub'], true);
  if (!isMap(config)) throw new Error('plugins.stub must be a mapping.');
  const configKey = document.getIn(['plugins', 'stub', 'configKey']);
  if (typeof configKey !== 'string' || !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(configKey)) {
    throw new Error('plugins.stub.configKey must be a non-empty dotted YAML key.');
  }
  const path = configKey.split('.');
  if (!document.hasIn(path)) throw new Error(`Stub config key "${configKey}" was not found.`);
  const value = document.getIn(path);
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new Error('Stub config value must be a scalar (string, number, boolean or null).');
  }
  return { name: 'stub' as const, configKey, value };
}
