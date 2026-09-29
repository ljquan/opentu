import {
  isNativeParameter,
  isNativeReferenceInputs,
  type NativeParameter,
  type NativeReferenceInputs,
} from './native-parameters';

export const MODEL_DEFAULTS_REQUEST = 'opentu:model-defaults:request:v1';
export const MODEL_DEFAULTS_RESPONSE = 'opentu:model-defaults:response:v1';
export type Capability = 'image' | 'video' | 'text' | 'audio';
export interface WorkflowChannel {
  opentuProfileId?: string | null;
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: 'openai' | 'gemini';
  models: {
    name: string;
    capability: Capability;
    script?: string;
    parameters?: NativeParameter[];
    referenceInputs?: NativeReferenceInputs;
    adapterId?: string;
    requestSchema?: string;
    unavailableReason?: string;
  }[];
}
export interface ModelDefaults {
  channels: WorkflowChannel[];
  defaults: Record<Capability, string>;
  warnings: string[];
  coverage?: NativeModelCoverage[];
}

export interface NativeModelCoverage {
  profileId: string | null;
  modelId: string;
  capability: Capability;
  status:
    | 'configured'
    | 'unconfigured'
    | 'upstream-unavailable'
    | 'parameter-contract-missing';
  parameterIds: string[];
  consumers: Record<string, string>;
  referenceInputs: NativeReferenceInputs;
  adapterId?: string;
  requestSchema?: string;
  reason?: string;
}

export function isModelDefaults(value: unknown): value is ModelDefaults {
  if (!value || typeof value !== 'object') return false;
  const data = value as ModelDefaults;
  const capabilities = ['image', 'video', 'text', 'audio'];
  return (
    Array.isArray(data.channels) &&
    data.channels.every(
      (channel) =>
        channel &&
        typeof channel.id === 'string' &&
        typeof channel.name === 'string' &&
        typeof channel.baseUrl === 'string' &&
        typeof channel.apiKey === 'string' &&
        (channel.opentuProfileId === undefined ||
          channel.opentuProfileId === null ||
          typeof channel.opentuProfileId === 'string') &&
        ['openai', 'gemini'].includes(channel.apiFormat) &&
        Array.isArray(channel.models) &&
        channel.models.every(
          (model) =>
            model &&
            typeof model.name === 'string' &&
            capabilities.includes(model.capability) &&
            model.script === undefined &&
            (model.parameters === undefined ||
              (Array.isArray(model.parameters) &&
                model.parameters.every(isNativeParameter))) &&
            (model.referenceInputs === undefined ||
              isNativeReferenceInputs(model.referenceInputs)) &&
            (model.adapterId === undefined ||
              typeof model.adapterId === 'string') &&
            (model.unavailableReason === undefined ||
              typeof model.unavailableReason === 'string')
        )
    ) &&
    !!data.defaults &&
    capabilities.every(
      (key) => typeof data.defaults[key as Capability] === 'string'
    ) &&
    Array.isArray(data.warnings) &&
    data.warnings.every((item) => typeof item === 'string')
  );
}

// Compare values, not JSON property order; user edits must survive initialization.
export function sameConfig(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = Object.entries(right).filter(([, value]) => value !== undefined);
  return (
    a.length === b.length &&
    a.every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameConfig(value, (right as Record<string, unknown>)[key])
    )
  );
}
