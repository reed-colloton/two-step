'use client';

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import type { ModelOption } from '@/lib/models';

export function ModelPicker({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: ModelOption[];
  onChange: (id: string) => void;
}) {
  const selected = options.find((model) => model.id === value) ?? {
    id: value,
    name: value,
  };
  const items = options.some((model) => model.id === value)
    ? options
    : [selected, ...options];
  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(model) => {
        if (model) onChange(model.id);
      }}
      itemToStringLabel={(model) => model.name}
      itemToStringValue={(model) => model.id}
      isItemEqualToValue={(a, b) => a.id === b.id}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        className="model-picker"
        placeholder="Search models…"
      />
      <ComboboxContent className="model-options">
        <ComboboxEmpty>No matching models.</ComboboxEmpty>
        <ComboboxList>
          {(model: ModelOption) => (
            <ComboboxItem key={model.id} value={model}>
              <span className="model-option">
                <span>{model.name}</span>
                <small>{model.id.split('/')[0]}</small>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
